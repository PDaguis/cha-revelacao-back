/* As regras do palpite, iguais em qualquer lugar onde a API rode:
   no servidor de casa, no Docker ou no Lambda. */

export const ESCOLHAS = ['menino', 'menina'];
export const LIMITE_DE_VOTOS = 2000;

/* Cada convidado palpita uma vez só. Para comparar dois nomes ignoramos
   acento, espaço sobrando e maiúscula: "Vovó Cida" e "vovo  cida" são a
   mesma pessoa. */
export function chave(nome) {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/* Devolve { voto } ou { erro }. A hora quem carimba é o servidor, não o
   aparelho do convidado. */
export function conferir(dados) {
  const nome = String(dados?.nome ?? '').trim().replace(/\s+/g, ' ');
  const escolha = String(dados?.escolha ?? '').trim().toLowerCase();

  if (nome.length < 2) return { erro: 'diga o seu nome' };
  if (nome.length > 60) return { erro: 'nome comprido demais' };
  if (!ESCOLHAS.includes(escolha)) return { erro: 'a escolha deve ser menino ou menina' };

  return { voto: { nome, escolha, em: new Date().toISOString() } };
}

export function resumo(votos) {
  const menino = votos.filter((v) => v.escolha === 'menino').length;
  const menina = votos.filter((v) => v.escolha === 'menina').length;
  return { total: menino + menina, menino, menina };
}

/* Erro combinado entre os armazéns: o nome já palpitou. */
export const JA_VOTOU = 'ja-votou';
