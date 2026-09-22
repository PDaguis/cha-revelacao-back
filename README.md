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
- **um palpite por convidado**: se aquele nome já palpitou, a resposta é `409` e
  nada muda. A comparação ignora maiúscula, acento e espaço sobrando, então
  "Vovó Cida", "vovo cida" e "VOVÓ  CIDA" são a mesma pessoa. Por isso o tablet
  pede nome e sobrenome — e por isso dois convidados de mesmo nome precisam se
  diferenciar de alguma forma.

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

## Subir com Docker (o jeito recomendado)

O `docker-compose.yml` sobe as duas metades: o **Caddy** servindo o site e
repassando `/api` para o **Node**. Um endereço só, o que elimina de uma vez o
CORS e a mistura de `http` com `https` — e o certificado é emitido e renovado
sozinho.

No servidor, com Docker instalado e o domínio já apontando para o IP dele:

```bash
git clone <front> cha-revelacao-front
git clone <back>  cha-revelacao-back
cd cha-revelacao-back
cp .env.example .env     # preencha DOMINIO e ADMIN_TOKEN
docker compose up -d --build
```

Os dois repositórios precisam estar **lado a lado**, como estão aqui: o compose
constrói o site a partir de `../cha-revelacao-front`.

Alguns detalhes que valem saber:

- **os palpites ficam num volume** (`palpites`), então `docker compose restart`,
  `down`/`up` e deploy novo não apagam nada. Só `down -v` apaga;
- **a API não fica exposta**: ela não publica porta nenhuma, só é alcançada por
  dentro, pelo `/api` do Caddy;
- **o `apiUrl` é forçado para `/api` na hora de montar a imagem do site**, não
  importa o que esteja no `config.js`. É de propósito: esquecer isso faria o
  site guardar os palpites em cada navegador, e a festa inteira daria certo em
  aparência e errado no placar;
- **o certificado também fica num volume**, para não ser emitido de novo a cada
  reinício;
- **suba um container só da API.** Os palpites vivem num arquivo; duas réplicas
  seriam duas listas separadas.

Para testar na sua máquina antes, sem domínio e sem HTTPS, ponha `DOMINIO=:80`
no `.env` e abra http://localhost.

### No dia

```bash
# apagar os palpites de teste
curl -X DELETE "https://SEU-DOMINIO/api/votos?senha=SEU_ADMIN_TOKEN"

# guardar uma cópia antes da revelação
curl -sS https://SEU-DOMINIO/api/votos > palpites.json

# ver o que está acontecendo
docker compose logs -f api
```

## Publicar sem Docker

Se preferir sem container, serve qualquer lugar que rode Node
([Render](https://render.com), [Railway](https://railway.app),
[Fly.io](https://fly.io)). O comando de start é `node server.js` e não há build.

Dois cuidados:

- **Disco temporário.** Em plano gratuito, o disco costuma ser apagado a cada
  reinício ou novo deploy — e os palpites vão junto. Se for usar assim, ligue um
  disco persistente e aponte o `DATA_FILE` para ele, ou pelo menos baixe o
  `GET /votos` antes da revelação.
- **Qualquer um com o endereço pode votar.** Não tem login: é uma festa. Se
  aparecer palpite de brincalhão, o `DELETE /votos?senha=…` limpa tudo.

Antes da festa, vale apagar os palpites de teste.
