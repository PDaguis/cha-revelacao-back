/* As regras das fotos, separadas do transporte para poderem rodar sozinhas.
   Aqui não tem AWS nenhuma: só o nome dos arquivos, os limites e as contas.

   A ideia central: não existe banco de dados das fotos. O arquivo no S3 é o
   registro, e tudo que a galeria precisa saber está na chave dele. */

export const TIPO = 'image/jpeg';   // o navegador sempre reencoda antes de enviar

export const MENOR = 500;                    // menos que isso não é foto
export const MAIOR_GRANDE = 6 * 1024 * 1024; // sobra folgada para 1600px
export const MAIOR_MINI = 500 * 1024;        // a miniatura de 400px dá ~40 KB
export const POR_PAGINA = 24;

export const PASTA_GRANDE = 'f/';
export const PASTA_MINI = 't/';

/* O S3 só devolve chave em ordem crescente e não sabe inverter. Então
   guardamos o tempo de trás para frente: assim "mais recente primeiro" sai
   de graça, sem ordenar nada na memória e sem tabela nenhuma. Dez dígitos
   seguram qualquer data até o ano 2286. */
const FIM_DOS_TEMPOS = 9999999999;

export function carimbo(agora = Date.now()) {
  return String(FIM_DOS_TEMPOS - Math.floor(agora / 1000)).padStart(10, '0');
}

export function quando(carimbado) {
  return new Date((FIM_DOS_TEMPOS - Number(carimbado)) * 1000).toISOString();
}

/* O nome do convidado vai dentro da própria chave — é o que deixa a galeria
   funcionar sem tabela. Em troca, o acento se perde: "Vovó Cida" vira
   "vovo-cida". Para legenda de foto de festa, troca justa. */
export function apelido(nome) {
  const limpo = String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 28)
    .replace(/-+$/, '');
  return limpo || 'convidado';
}

export function mostrar(apelidado) {
  return apelidado
    .split('-')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

const LETRAS = 'abcdefghijkmnopqrstuvwxyz23456789';

function sorteio(quantas = 6) {
  let fim = '';
  for (let i = 0; i < quantas; i++) fim += LETRAS[Math.floor(Math.random() * LETRAS.length)];
  return fim;
}

/* f/8209617310-k3f9ab-vovo-cida.jpg, e a miniatura na mesma chave em t/.
   Ficando o par no mesmo sufixo, a galeria acha uma pela outra sem guardar
   relação em lugar nenhum. */
export function chaves(nome, agora = Date.now()) {
  const fim = `${carimbo(agora)}-${sorteio()}-${apelido(nome)}.jpg`;
  return { grande: PASTA_GRANDE + fim, mini: PASTA_MINI + fim };
}

/* O contrário: o que a chave da miniatura tem a contar. */
export function lerChave(chaveMini) {
  const fim = chaveMini.slice(PASTA_MINI.length).replace(/\.jpg$/, '');
  const partes = fim.split('-');
  const carimbado = partes[0];
  return {
    grande: PASTA_GRANDE + chaveMini.slice(PASTA_MINI.length),
    nome: mostrar(partes.slice(2).join('-')),
    em: /^\d{10}$/.test(carimbado) ? quando(carimbado) : null,
  };
}

/* Confere o pedido de upload antes de assinar qualquer coisa. Devolve
   { pedido } ou { erro }. Tamanho vem do navegador, mas quem manda é a
   condição assinada no POST: mentir aqui não adianta, o S3 recusa. */
export function conferir(dados) {
  const nome = String(dados?.nome ?? '').trim().replace(/\s+/g, ' ');
  const grande = Number(dados?.grande);
  const mini = Number(dados?.mini);

  if (nome.length < 2) return { erro: 'diga o seu nome' };
  if (nome.length > 60) return { erro: 'nome comprido demais' };
  if (!Number.isFinite(grande) || !Number.isFinite(mini)) return { erro: 'faltou o tamanho da foto' };
  if (grande < MENOR || mini < MENOR) return { erro: 'essa foto é pequena demais para ser foto' };
  if (grande > MAIOR_GRANDE) return { erro: 'essa foto passou do tamanho' };
  if (mini > MAIOR_MINI) return { erro: 'a miniatura passou do tamanho' };

  return { pedido: { nome, grande, mini } };
}
