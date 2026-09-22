/* Armazém em arquivo JSON — usado no servidor de casa e no Docker. */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chave, JA_VOTOU, LIMITE_DE_VOTOS } from '../regras.js';

const ARQUIVO = resolve(process.env.DATA_FILE || './dados/votos.json');

let votos = carregar();

function carregar() {
  try {
    const lido = JSON.parse(readFileSync(ARQUIVO, 'utf8'));
    return Array.isArray(lido) ? lido : [];
  } catch {
    return []; // primeira vez: ainda não existe arquivo
  }
}

function salvar() {
  mkdirSync(dirname(ARQUIVO), { recursive: true });
  writeFileSync(ARQUIVO, JSON.stringify(votos, null, 2));
}

export const onde = ARQUIVO;

export async function listar() {
  return votos;
}

export async function guardar(voto) {
  if (votos.some((v) => chave(v.nome) === chave(voto.nome))) {
    throw new Error(JA_VOTOU);
  }
  if (votos.length >= LIMITE_DE_VOTOS) {
    throw new Error('limite');
  }
  votos = [...votos, voto];
  salvar();
  return votos;
}

export async function apagarTudo() {
  const apagados = votos.length;
  votos = [];
  salvar();
  return apagados;
}
