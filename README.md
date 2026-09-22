# Chá Revelação — API dos palpites 💙💗

Servidor que guarda os palpites do [cha-revelacao-front](../cha-revelacao-front),
para que todo mundo veja o mesmo placar: quem vota no tablet e quem vota no
próprio celular depois de escanear o QR Code.

> **Na festa, o site fica na Vercel e esta API no Lambda da AWS.** Veja
> [Subir no Lambda (AWS)](#subir-no-lambda-aws).

Node puro, **sem nenhuma dependência** — nada de `npm install`.

```
regras.js            as regras do palpite, valem em qualquer lugar
armazens/arquivo.js  guarda num arquivo JSON  (servidor de casa e Docker)
armazens/dynamo.js   guarda no DynamoDB       (Lambda)
server.js            a API como servidor HTTP (casa e Docker)
lambda.mjs           a API como função da AWS
aws/implantar.sh     sobe tudo na AWS
```

As regras ficam num arquivo só, então o Lambda e o servidor do Docker se
comportam igual: um palpite por nome, escolha só menino ou menina, e a hora
carimbada pelo servidor.

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
apiUrl: 'https://xxxxxxxx.lambda-url.us-east-1.on.aws',   // no Lambda
apiUrl: '/api',                                           // com tudo junto no Docker
```

A partir daí o site para de guardar no navegador e passa a somar tudo aqui.

> Se o site estiver em `https`, a API também precisa estar — o navegador recusa
> chamar `http` de dentro de uma página `https`.

## Subir no Lambda (AWS)

A API vira uma função Lambda com **Function URL** — um endereço HTTPS pronto,
sem certificado, sem domínio e sem balanceador — e os palpites ficam no
**DynamoDB**, porque no Lambda não existe disco que sobreviva de uma requisição
para a outra.

Antes de rodar, três coisas precisam estar prontas:

1. **uma conta na AWS** (o cadastro pede um cartão, mesmo no plano gratuito);
2. **a AWS CLI instalada** — no macOS, `brew install awscli`;
3. **a CLI conectada na conta**, com `aws configure`. Ela pede uma Access Key e
   uma Secret Key, que saem do **IAM → Users → seu usuário → Security
   credentials → Create access key**, escolhendo o uso "Command Line Interface".
   Não use as chaves da conta raiz: crie um usuário no IAM para isso.

O script confere esses três pontos e diz qual está faltando, em vez de falhar
com erro da AWS. Então, de dentro desta pasta:

```bash
SITE=https://seu-site.vercel.app ADMIN_TOKEN=uma-senha ./aws/implantar.sh
```

A região padrão é `us-east-2` (Ohio). Isso não é à toa: contas novas do plano
gratuito da AWS entram numa organização com uma política que só libera a região
escolhida no cadastro, e tentar em outra dá `AccessDeniedException` com
`explicit deny in a service control policy` — erro que nenhuma permissão do IAM
resolve. Para usar outra região, passe `REGIAO=` e confirme antes que ela está
liberada.

O script cria a tabela, o papel do IAM com permissão só nela, a função e o
API Gateway — e, antes de terminar, chama o endereço de fora para confirmar que
responde. No fim imprime a linha pronta para colar no `config.js` do front.
Pode rodar de novo quantas vezes quiser: nas próximas ele só atualiza o código
e as variáveis.

O API Gateway é procurado pelo nome (`cha-revelacao` por padrão). Se a sua API
tiver outro nome, passe `API_NOME=` com ele — senão o script cria uma segunda.

Dá para mudar `REGIAO`, `FUNCAO`, `TABELA` e `PAPEL` da mesma forma, por
variável de ambiente.

**O `SITE` é o CORS.** É o endereço que a API vai aceitar. Se o do site mudar,
rode o script de novo com o novo — senão o navegador bloqueia as chamadas. Sem
passar `SITE`, o CORS fica aberto para qualquer origem e o script avisa.

O `ADMIN_TOKEN` é a senha do `DELETE /votos`, para limpar os palpites de teste
antes da festa:

```bash
curl -X DELETE "https://SUA-URL.lambda-url.us-east-1.on.aws/votos?senha=SUA_SENHA"
curl -sS https://SUA-URL.lambda-url.us-east-1.on.aws/votos > palpites.json
```

Sobre o pacote: o runtime do Node no Lambda **já traz o AWS SDK v3**, então o
zip leva só os arquivos do projeto — nada de `npm install` nem de camadas.

### Três pegadinhas desta conta AWS

Contas novas do plano gratuito entram numa organização gerenciada pela AWS, com
políticas que **não dá para contornar por dentro da conta** — nem com
`AdministratorAccess`, nem com o usuário raiz. Nós esbarramos em duas delas e
numa terceira que é erro comum. Ficam registradas para ninguém perder tempo de
novo:

1. **Só a região escolhida no cadastro funciona.** Aqui é `us-east-2` (Ohio).
   Tentar em qualquer outra dá `AccessDeniedException` com
   `explicit deny in a service control policy`. É por isso que `REGIAO` já vem
   com Ohio.

2. **Function URL pública é proibida.** Mesmo com `AuthType NONE` e a permissão
   de invocação corretamente aplicadas, a chamada volta `403 Forbidden` — e sem
   log nenhum, porque a função nem chega a rodar. No navegador isso aparece
   disfarçado de erro de CORS ("No 'Access-Control-Allow-Origin' header"), já
   que a resposta de recusa não tem os cabeçalhos que a função responderia.
   A saída foi o API Gateway, que a mesma política não bloqueia.

3. **O `SITE` não pode ter barra no final.** A origem que o navegador envia é
   `https://site.vercel.app`, sem barra, e a comparação do CORS é literal. O
   script tira a barra sozinho, mas se você configurar na mão, atenção.

### Rodar o Lambda na sua máquina

Dá para testar sem AWS nenhuma, com um DynamoDB local em Docker:

```bash
docker run -d -p 8000:8000 amazon/dynamodb-local
npm install --no-save @aws-sdk/client-dynamodb   # no Lambda isso já vem pronto
```

Depois é só chamar o `handler` do `lambda.mjs` com
`AWS_ENDPOINT_URL_DYNAMODB=http://localhost:8000` e credenciais de mentira.

## Subir com Docker (plano B)

Se um dia preferir tudo num servidor próprio, o `docker-compose.yml` sobe as
duas metades: o **Caddy** servindo o site e repassando `/api` para o **Node**. Um endereço só, o que elimina de uma vez o
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
