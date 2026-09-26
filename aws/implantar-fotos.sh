#!/usr/bin/env bash
#
# Sobe as fotos da festa: um bucket privado no S3 e uma função só dela,
# pendurada no mesmo API Gateway que os palpites já usam.
# Rodar de dentro da pasta do back:  ./aws/implantar-fotos.sh
#
# A função dos palpites não é tocada aqui. São duas funções de propósito:
# a votação é o que não pode falhar no dia, e código de foto não tem como
# derrubar o que ele nem enxerga.
#
# Pode rodar quantas vezes quiser: na primeira cria, nas outras atualiza.

set -euo pipefail

REGIAO="${REGIAO:-us-east-2}"          # a região liberada na nossa conta
FUNCAO="${FUNCAO:-cha-revelacao-fotos}"
PAPEL="${PAPEL:-cha-revelacao-fotos}"
API_NOME="${API_NOME:-cha-revelacao}"  # o mesmo do implantar.sh
SITE="${SITE:-*}"                      # endereço do site, para o CORS
SITE="${SITE%/}"
CODIGO="${CODIGO:-}"                   # o código que o site manda; vazio desliga os envios
ADMIN_TOKEN="${ADMIN_TOKEN:-}"         # senha para apagar foto; vazio desliga

# ---------- confere o que precisa estar pronto ----------
if ! command -v aws >/dev/null 2>&1; then
  echo "A AWS CLI não está instalada."
  echo "No macOS:  brew install awscli"
  exit 1
fi

if ! conta=$(aws sts get-caller-identity --query Account --output text 2>/dev/null); then
  echo "A AWS CLI está instalada, mas não está conectada na sua conta."
  echo "Rode:  aws configure"
  exit 1
fi

# Nome de bucket é único no mundo inteiro, não só na sua conta. O pedacinho
# de hash da conta garante que o nome existe uma vez só, sem expor o número.
sufixo=$(printf %s "$conta" | openssl dgst -sha1 -hex | sed 's/.*[= ]//' | cut -c1-8)
BUCKET="${BUCKET:-cha-revelacao-fotos-$sufixo}"

if [ -z "$CODIGO" ]; then
  echo "Sem CODIGO os envios sobem desligados (a função recusa toda foto)."
  echo "Rode assim:  CODIGO=1710 SITE=https://eduardaepedro.vercel.app ./aws/implantar-fotos.sh"
  echo
fi

echo "Conta $conta, região $REGIAO."
echo "Vou criar (ou atualizar, se já existir):"
echo "  bucket  $BUCKET  — onde as fotos ficam, fechado para o mundo"
echo "  papel   $PAPEL  — permissão da função, só nesse bucket"
echo "  função  $FUNCAO  — assina, lista e apaga"
echo "  rotas   /fotos no API Gateway $API_NOME"
echo

# ---------- 1. o bucket ----------
if aws s3api head-bucket --bucket "$BUCKET" --region "$REGIAO" >/dev/null 2>&1; then
  echo "bucket $BUCKET já existe"
else
  echo "criando o bucket $BUCKET..."
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGIAO" \
    --create-bucket-configuration "LocationConstraint=$REGIAO" >/dev/null
fi

# fechado para o mundo: toda leitura e toda escrita passa por URL assinada
aws s3api put-public-access-block --bucket "$BUCKET" --region "$REGIAO" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# o navegador do convidado só consegue mandar a foto se o bucket deixar
aws s3api put-bucket-cors --bucket "$BUCKET" --region "$REGIAO" --cors-configuration "{
  \"CORSRules\": [{
    \"AllowedOrigins\": [\"$SITE\"],
    \"AllowedMethods\": [\"POST\", \"GET\"],
    \"AllowedHeaders\": [\"*\"],
    \"ExposeHeaders\": [\"ETag\"],
    \"MaxAgeSeconds\": 3000
  }]
}"

# ---------- 2. o papel da função ----------
if aws iam get-role --role-name "$PAPEL" >/dev/null 2>&1; then
  echo "papel $PAPEL já existe"
else
  echo "criando o papel $PAPEL..."
  aws iam create-role --role-name "$PAPEL" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }' >/dev/null
  aws iam attach-role-policy --role-name "$PAPEL" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "esperando o papel valer na AWS..."
  sleep 12
fi

# só o que a função precisa, e só nesse bucket
aws iam put-role-policy --role-name "$PAPEL" --policy-name fotos --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {
      \"Effect\": \"Allow\",
      \"Action\": [\"s3:PutObject\", \"s3:GetObject\", \"s3:DeleteObject\"],
      \"Resource\": \"arn:aws:s3:::$BUCKET/*\"
    },
    {
      \"Effect\": \"Allow\",
      \"Action\": \"s3:ListBucket\",
      \"Resource\": \"arn:aws:s3:::$BUCKET\"
    }
  ]
}"

# ---------- 3. o pacote ----------
# Esta função leva o SDK preso no zip, em versão fixa. A da votação não leva
# nada: lá o SDK do runtime basta. Aqui eu prefiro saber exatamente qual
# versão vai rodar no dia 17 do que descobrir por sondagem.
echo "instalando as dependências..."
npm install --omit=dev --silent
echo "empacotando..."
rm -f /tmp/cha-revelacao-fotos.zip
zip -qr /tmp/cha-revelacao-fotos.zip lambda-fotos.mjs fotos-regras.js package.json node_modules
echo "pacote: $(du -h /tmp/cha-revelacao-fotos.zip | cut -f1)"

# ---------- 4. a função ----------
ambiente="Variables={BUCKET=$BUCKET,CORS_ORIGIN=$SITE,CODIGO=$CODIGO,ADMIN_TOKEN=$ADMIN_TOKEN}"

if aws lambda get-function --function-name "$FUNCAO" --region "$REGIAO" >/dev/null 2>&1; then
  echo "atualizando a função $FUNCAO..."
  aws lambda update-function-code --function-name "$FUNCAO" \
    --zip-file fileb:///tmp/cha-revelacao-fotos.zip --region "$REGIAO" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCAO" --region "$REGIAO"
  aws lambda update-function-configuration --function-name "$FUNCAO" \
    --environment "$ambiente" --region "$REGIAO" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCAO" --region "$REGIAO"
else
  echo "criando a função $FUNCAO..."
  aws lambda create-function --function-name "$FUNCAO" \
    --runtime nodejs22.x \
    --role "arn:aws:iam::$conta:role/$PAPEL" \
    --handler lambda-fotos.handler \
    --timeout 15 \
    --memory-size 256 \
    --zip-file fileb:///tmp/cha-revelacao-fotos.zip \
    --environment "$ambiente" \
    --region "$REGIAO" >/dev/null
  aws lambda wait function-active --function-name "$FUNCAO" --region "$REGIAO"
fi

# ---------- 5. as rotas no API Gateway que já existe ----------
api_id=$(aws apigatewayv2 get-apis --region "$REGIAO" \
  --query "Items[?Name=='$API_NOME'].ApiId | [0]" --output text)

if [ "$api_id" = "None" ] || [ -z "$api_id" ]; then
  echo
  echo "Não achei o API Gateway $API_NOME nesta região."
  echo "Suba primeiro a API dos palpites:  ./aws/implantar.sh"
  exit 1
fi

funcao_arn=$(aws lambda get-function --function-name "$FUNCAO" --region "$REGIAO" \
  --query Configuration.FunctionArn --output text)

integracao=$(aws apigatewayv2 get-integrations --api-id "$api_id" --region "$REGIAO" \
  --query "Items[?IntegrationUri=='$funcao_arn'].IntegrationId | [0]" --output text)

if [ "$integracao" = "None" ] || [ -z "$integracao" ]; then
  echo "ligando a função no API Gateway..."
  integracao=$(aws apigatewayv2 create-integration --api-id "$api_id" \
    --integration-type AWS_PROXY --integration-uri "$funcao_arn" \
    --integration-method POST --payload-format-version 2.0 \
    --region "$REGIAO" --query IntegrationId --output text)
fi

# rotas explícitas ganham do $default, que continua indo para a votação
for rota in "ANY /fotos" "ANY /fotos/{proxy+}"; do
  existe=$(aws apigatewayv2 get-routes --api-id "$api_id" --region "$REGIAO" \
    --query "Items[?RouteKey=='$rota'].RouteId | [0]" --output text)
  if [ "$existe" = "None" ] || [ -z "$existe" ]; then
    echo "criando a rota $rota..."
    aws apigatewayv2 create-route --api-id "$api_id" --route-key "$rota" \
      --target "integrations/$integracao" --region "$REGIAO" >/dev/null
  else
    aws apigatewayv2 update-route --api-id "$api_id" --route-id "$existe" \
      --target "integrations/$integracao" --region "$REGIAO" >/dev/null
  fi
done

# deixa o API Gateway chamar a função; se já puder, a AWS reclama e tudo bem
aws lambda add-permission --function-name "$FUNCAO" \
  --statement-id apigateway --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGIAO:$conta:$api_id/*/*" \
  --region "$REGIAO" >/dev/null 2>&1 || true

endereco="https://$api_id.execute-api.$REGIAO.amazonaws.com"

# ---------- 6. confere de fora, como o site vai chamar ----------
echo "conferindo o endereço..."
codigo_http="000"
for _ in 1 2 3; do
  codigo_http=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$endereco/fotos" || echo "000")
  [ "$codigo_http" = "200" ] && break
  sleep 3
done

if [ "$codigo_http" != "200" ]; then
  echo
  echo "O endereço /fotos respondeu $codigo_http em vez de 200."
  echo "Veja o log:  aws logs tail /aws/lambda/$FUNCAO --since 5m --region $REGIAO"
  exit 1
fi

# a votação tem que continuar respondendo igual
votos_http=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$endereco/votos" || echo "000")

echo
echo "Fotos no ar: $endereco/fotos"
echo "Votação: /votos respondeu $votos_http (tem que ser 200)"
echo "Bucket:  $BUCKET"
echo
echo "No config.js do front, o apiUrl é o mesmo de antes. Confira só o código:"
echo
echo "  codigoFotos: '$CODIGO',"
echo
echo "Para desligar os envios na hora, sem publicar nada:"
echo "  aws lambda update-function-configuration --function-name $FUNCAO \\"
echo "    --environment 'Variables={BUCKET=$BUCKET,CORS_ORIGIN=$SITE,CODIGO=,ADMIN_TOKEN=$ADMIN_TOKEN}' --region $REGIAO"
echo
echo "Depois da festa, para baixar tudo:"
echo "  aws s3 sync s3://$BUCKET ./fotos-da-festa --region $REGIAO"
