/* Armazém no DynamoDB — usado quando a API roda no Lambda.
   O SDK da AWS já vem dentro do runtime do Lambda, então não há nada
   para instalar. */

import {
  DynamoDBClient,
  PutItemCommand,
  ScanCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { chave, JA_VOTOU } from '../regras.js';

const TABELA = process.env.TABELA || 'cha-revelacao-votos';

// AWS_ENDPOINT_URL_DYNAMODB aponta para um DynamoDB local, quando existe
const cliente = new DynamoDBClient({});

export const onde = `DynamoDB (tabela ${TABELA})`;

function paraItem(voto) {
  return {
    chave: { S: chave(voto.nome) },
    nome: { S: voto.nome },
    escolha: { S: voto.escolha },
    em: { S: voto.em },
  };
}

function paraVoto(item) {
  return { nome: item.nome.S, escolha: item.escolha.S, em: item.em.S };
}

export async function listar() {
  const votos = [];
  let daqui;

  do {
    const pagina = await cliente.send(new ScanCommand({
      TableName: TABELA,
      ExclusiveStartKey: daqui,
    }));
    votos.push(...(pagina.Items ?? []).map(paraVoto));
    daqui = pagina.LastEvaluatedKey;
  } while (daqui);

  // o Scan devolve fora de ordem; o placar mostra os últimos palpites
  return votos.sort((a, b) => a.em.localeCompare(b.em));
}

export async function guardar(voto) {
  try {
    // a condição é o que garante um palpite por convidado: se a chave já
    // existe, o DynamoDB recusa a escrita — sem ler antes, sem brecha entre
    // dois convidados confirmando no mesmo instante
    await cliente.send(new PutItemCommand({
      TableName: TABELA,
      Item: paraItem(voto),
      ConditionExpression: 'attribute_not_exists(chave)',
    }));
  } catch (falha) {
    if (falha.name === 'ConditionalCheckFailedException') throw new Error(JA_VOTOU);
    throw falha;
  }

  return listar();
}

export async function apagarTudo() {
  const itens = await listar();

  for (let i = 0; i < itens.length; i += 25) { // o BatchWrite vai de 25 em 25
    await cliente.send(new BatchWriteItemCommand({
      RequestItems: {
        [TABELA]: itens.slice(i, i + 25).map((voto) => ({
          DeleteRequest: { Key: { chave: { S: chave(voto.nome) } } },
        })),
      },
    }));
  }

  return itens.length;
}
