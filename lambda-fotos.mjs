/* As fotos da festa, no Lambda, atrás do mesmo API Gateway dos palpites.
 *
 * Esta função nunca vê uma foto. Ela assina uma permissão de escrita curta,
 * o celular manda os bytes direto para o S3, e depois ela lista o que existe
 * no bucket e assina permissões de leitura. É por isso que ela é pequena:
 * o trabalho pesado não passa por aqui.
 *
 * Rotas:
 *   POST   /fotos/assinar   -> duas URLs assinadas (foto grande + miniatura)
 *   GET    /fotos?cursor=   -> a galeria, mais recentes primeiro
 *   DELETE /fotos?chave=&senha=  -> tira uma foto do ar (uso do casal)
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import * as regras from './fotos-regras.js';

const BUCKET = process.env.BUCKET || '';
const ORIGEM = process.env.CORS_ORIGIN || '*';
const CODIGO = process.env.CODIGO || '';      // vazio desliga os envios de uma vez
const SENHA = process.env.ADMIN_TOKEN || '';  // sem senha, apagar fica desligado

const VALE_ENVIAR = 300;    // 5 minutos para o celular subir a foto
const VALE_VER = 3600;      // 1 hora para a galeria; o papel do Lambda não deixa mais

const s3 = new S3Client({});

function responder(status, corpo) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': ORIGEM,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(corpo),
  };
}

function lerCorpo(evento) {
  if (!evento.body) return {};
  const bruto = evento.isBase64Encoded
    ? Buffer.from(evento.body, 'base64').toString('utf8')
    : evento.body;
  return JSON.parse(bruto);
}

/* A permissão de escrita mais estreita que o S3 sabe dar: uma chave exata,
   um tipo exato e um tamanho entre dois valores. Mentir no tamanho não
   resolve nada para quem tentar — a condição está dentro da assinatura e é
   o S3 que confere, não este código. */
async function permitirEnvio(chave, tamanho) {
  return createPresignedPost(s3, {
    Bucket: BUCKET,
    Key: chave,
    Conditions: [
      ['content-length-range', regras.MENOR, tamanho],
      ['eq', '$Content-Type', regras.TIPO],
    ],
    Fields: { 'Content-Type': regras.TIPO },
    Expires: VALE_ENVIAR,
  });
}

function permitirLeitura(chave, segundos = VALE_VER) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: chave }), { expiresIn: segundos });
}

async function assinar(evento) {
  if (!CODIGO) return responder(503, { erro: 'os envios de foto estão desligados' });

  let corpo;
  try {
    corpo = lerCorpo(evento);
  } catch {
    return responder(400, { erro: 'não entendi o que veio no pedido' });
  }

  if (String(corpo.codigo ?? '') !== CODIGO) {
    return responder(403, { erro: 'esta página não está valendo para enviar fotos' });
  }

  const { pedido, erro } = regras.conferir(corpo);
  if (erro) return responder(400, { erro });

  const chaves = regras.chaves(pedido.nome);
  const [grande, mini] = await Promise.all([
    permitirEnvio(chaves.grande, pedido.grande),
    permitirEnvio(chaves.mini, pedido.mini),
  ]);

  // a grande vai primeiro de propósito: a galeria lista as miniaturas, então
  // uma foto pela metade fica invisível em vez de aparecer quebrada
  return responder(200, {
    grande: { url: grande.url, campos: grande.fields, chave: chaves.grande },
    mini: { url: mini.url, campos: mini.fields, chave: chaves.mini },
  });
}

async function listar(evento) {
  const cursor = new URLSearchParams(evento.rawQueryString ?? '').get('cursor') || undefined;

  const lista = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: regras.PASTA_MINI,
    MaxKeys: regras.POR_PAGINA,
    ContinuationToken: cursor,
  }));

  const fotos = await Promise.all((lista.Contents ?? []).map(async (item) => {
    const dados = regras.lerChave(item.Key);
    const [mini, grande] = await Promise.all([
      permitirLeitura(item.Key),
      permitirLeitura(dados.grande),
    ]);
    return { chave: item.Key, nome: dados.nome, em: dados.em, mini, grande };
  }));

  return responder(200, { fotos, cursor: lista.NextContinuationToken ?? null });
}

async function apagar(evento) {
  const busca = new URLSearchParams(evento.rawQueryString ?? '');
  if (!SENHA || busca.get('senha') !== SENHA) return responder(403, { erro: 'senha inválida' });

  const chave = busca.get('chave') ?? '';
  // só apagamos o que tem cara de chave nossa: nada de caminho de fora
  if (!/^t\/\d{10}-[a-z0-9]{6}-[a-z0-9-]+\.jpg$/.test(chave)) {
    return responder(400, { erro: 'essa chave não é de uma foto' });
  }

  const { grande } = regras.lerChave(chave);
  await s3.send(new DeleteObjectsCommand({
    Bucket: BUCKET,
    Delete: { Objects: [{ Key: chave }, { Key: grande }], Quiet: true },
  }));

  return responder(200, { ok: true, apagada: chave });
}

export const handler = async (evento) => {
  const metodo = evento.requestContext?.http?.method ?? 'GET';
  const caminho = (evento.rawPath ?? '/').replace(/\/$/, '') || '/';

  try {
    if (metodo === 'OPTIONS') return responder(204, {});
    if (!BUCKET) return responder(500, { erro: 'falta dizer qual é o bucket' });

    if (caminho === '/fotos/assinar') {
      return metodo === 'POST' ? assinar(evento) : responder(405, { erro: 'só POST aqui' });
    }

    if (caminho === '/fotos') {
      if (metodo === 'GET') return listar(evento);
      if (metodo === 'DELETE') return apagar(evento);
      return responder(405, { erro: 'só GET ou DELETE aqui' });
    }

    return responder(404, { erro: 'essa rota não existe' });
  } catch (falha) {
    console.error(falha);
    return responder(500, { erro: 'deu algo errado aqui dentro' });
  }
};
