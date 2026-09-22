# Chá Revelação — API dos palpites 💙💗

Servidor que guarda os palpites do [cha-revelacao-front](../cha-revelacao-front),
para que todo mundo veja o mesmo placar: quem vota no tablet e quem vota no
próprio celular depois de escanear o QR Code.

Node puro, **sem nenhuma dependência** — nada de `npm install`. Os palpites
ficam num arquivo JSON.

## Rodar

```bash
node server.js
```

Ou `npm start`. Para reiniciar sozinho a cada alteração: `npm run dev`.

Sobe em http://localhost:3000 e cria o `dados/votos.json` no primeiro palpite.

## Rotas

| Rota                    | O que faz                                                            |
| ----------------------- | -------------------------------------------------------------------- |
| `GET /`                 | resumo rápido: `{ ok, total, menino, menina }`                        |
| `GET /votos`            | a lista toda: `[{ nome, escolha, em }]`                               |
| `POST /votos`           | recebe `{ nome, escolha }` e devolve **a lista já atualizada**         |
| `DELETE /votos?senha=…` | apaga tudo (só funciona com `ADMIN_TOKEN` configurado)                |

Sobre o `POST`:

- `escolha` precisa ser `menino` ou `menina` (aceita maiúscula, o servidor
  normaliza);
- o `nome` leva um aperto nos espaços e precisa ter de 2 a 60 letras;
- a hora (`em`) quem carimba é o servidor, não o aparelho do convidado;
- **o mesmo nome votando de novo substitui o palpite anterior** — é assim que o
  botão "Mudar meu palpite" funciona no celular. Vale lembrar que dois
  convidados com exatamente o mesmo nome contam como uma pessoa só; por isso o
  tablet pede nome e sobrenome.

Erros voltam como `{ "erro": "..." }` com status 400, 403 ou 404.

## Ajustes por variável de ambiente

| Variável      | Padrão               | Para quê                                                  |
| ------------- | -------------------- | --------------------------------------------------------- |
| `PORT`        | `3000`               | porta do servidor                                          |
| `DATA_FILE`   | `./dados/votos.json` | onde os palpites são gravados                              |
| `CORS_ORIGIN` | `*`                  | endereço do site; em produção, aponte para o site de vocês |
| `ADMIN_TOKEN` | vazio                | senha do `DELETE`; vazio deixa a rota desligada            |

Tem um `.env.example` aqui do lado. O Node lê `.env` sozinho:

```bash
node --env-file=.env server.js
```

## Ligar no site

No `config.js` do front, preencha a `apiUrl` com o endereço desta API:

```js
apiUrl: 'https://cha-revelacao-back.onrender.com',
```

A partir daí o site para de guardar no navegador e passa a somar tudo aqui.

> Se o site estiver em `https`, a API também precisa estar — o navegador recusa
> chamar `http` de dentro de uma página `https`.

## Publicar

Serve qualquer lugar que rode Node ([Render](https://render.com),
[Railway](https://railway.app), [Fly.io](https://fly.io)). O comando de start é
`node server.js` e não há build.

Dois cuidados:

- **Disco temporário.** Em plano gratuito, o disco costuma ser apagado a cada
  reinício ou novo deploy — e os palpites vão junto. Se for usar assim, ligue um
  disco persistente e aponte o `DATA_FILE` para ele, ou pelo menos baixe o
  `GET /votos` antes da revelação.
- **Qualquer um com o endereço pode votar.** Não tem login: é uma festa. Se
  aparecer palpite de brincalhão, o `DELETE /votos?senha=…` limpa tudo.

Antes da festa, vale apagar os palpites de teste.
