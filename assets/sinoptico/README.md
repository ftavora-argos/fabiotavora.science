# Gerador de laudos sinópticos

App estático publicado em `/laudos/` (página `_pages/laudos.md`, que embute `assets/sinoptico/index.html` por iframe).
O usuário clica nas respostas, o app monta o texto e o texto é copiado para o sistema do laboratório.
Nenhum dado é salvo ou enviado.

## Arquivos

| Arquivo                     | Função                                                               |
| --------------------------- | -------------------------------------------------------------------- |
| `index.html`, `app.css`     | Casca e estilo                                                       |
| `app.js`                    | Motor genérico. Não contém nenhuma regra de tumor                    |
| `schema.json`               | Formato dos templates                                                |
| `templates/index.json`      | Lista de protocolos da tela inicial                                  |
| `templates/*.json`          | Um arquivo por protocolo                                             |
| `bin/validar-sinoptico.mjs` | Valida os templates (na raiz do repositório, fora do site publicado) |

## Testar localmente

Na raiz do repositório:

```bash
node bin/validar-sinoptico.mjs
python3 -m http.server 8000
```

Abra `http://localhost:8000/assets/sinoptico/index.html`. O app não funciona aberto direto do disco (`file://`), porque carrega os templates por `fetch`.
Para ver dentro do site, com o tema e o iframe, use `docker compose up` e abra `http://localhost:8080/laudos/`.

Antes do commit: `npx prettier assets/sinoptico bin/validar-sinoptico.mjs _pages/laudos.md --write`.

## Criar um novo template

1. Copie `templates/pulmao-resseccao.json` para `templates/<orgao>-<procedimento>.json`.
2. Ajuste `meta` (`id` igual ao nome do arquivo sem `.json`, `versao`, `revisao`).
3. Escreva as `secoes` e os `campos` na ordem em que as linhas devem sair no laudo.
4. Acrescente uma entrada em `templates/index.json`.
5. Rode `node bin/validar-sinoptico.mjs` e confira o resultado no navegador.

### Campos

Todo campo tem `id`, `rotulo` e `tipo`. A linha gerada é `rotulo: texto`.

| Tipo        | Uso                                                              |
| ----------- | ---------------------------------------------------------------- |
| `unica`     | Escolha única (`opcoes`)                                         |
| `multipla`  | Múltipla escolha (`opcoes`); os itens saem separados por vírgula |
| `numero`    | Número com `unidade` opcional; aceita vírgula decimal            |
| `texto`     | Texto livre curto (`multilinha: true` para várias linhas)        |
| `calculado` | Escolha única com sugestão automática por `regras`               |

Propriedades opcionais:

- `nucleo: true`: item obrigatório. Se vazio, entra no contador e sai no laudo como `[PREENCHER]`. Itens não núcleo vazios não aparecem.
- `visivelSe`: condição para o campo existir (ver abaixo).
- `permiteOutro`, `permiteNaoAvaliavel`: acrescentam "outro (especificar)" e "não avaliável".
- `rotuloLaudo`: rótulo usado no laudo, quando diferente do rótulo do formulário.
- `formato`: molda o texto, por exemplo `"{valor} de extensão"`.
- `anexaEm` + `formato`: em vez de gerar linha própria, o texto é acrescentado à linha de outro campo (padrão predominante dentro do tipo histológico).
- `omitirNoLaudo: true`: o campo só alimenta regras de cálculo.
- `semRotulo: true`: o texto sai sem "rótulo:" (descrição livre).
- Em cada opção: `rotulo` é o que aparece no botão, `texto` é o que vai para o laudo (padrão: o próprio rótulo), `exclusiva: true` desmarca as demais numa múltipla escolha.
- Na seção: `cabecalhoLaudo` abre um bloco no laudo, com uma linha em branco antes.

### Condições

Usadas em `visivelSe`, nas `regras` e no `prefixo`. Todas as chaves de uma condição precisam ser verdadeiras.

```json
{ "campo": "tipo_histologico", "igual": "cec" }
{ "campo": "pleura", "em": ["pl1", "pl2"] }
{ "campo": "extensao", "contem": ["diafragma", "mediastino"] }
{ "campo": "estacoes", "contagemMin": 2 }
{ "campo": "estacoes", "contagemDe": { "valores": ["2R", "4R", "7"], "min": 2 } }
{ "campo": "tamanho_t", "maiorQue": 3, "menorOuIgual": 4 }
{ "todos": [{ "campo": "a", "igual": "x" }, { "nao": { "campo": "b", "preenchido": true } }] }
```

Operadores: `igual`, `em`, `naoEm`, `contem`, `contagemMin`, `contagemMax`, `contagemDe` (conta só os valores listados), `preenchido`, `maiorQue`, `maiorOuIgual`, `menorQue`, `menorOuIgual`, e os combinadores `todos`, `algum`, `nao`. Campo oculto conta como não respondido.

### Campos calculados

```json
{
  "id": "pT",
  "rotulo": "Tumor primário",
  "tipo": "calculado",
  "prefixo": { "padrao": "p", "regras": [{ "se": { "campo": "neoadjuvante", "igual": "realizado" }, "valor": "yp" }] },
  "opcoes": [
    { "valor": "T1a", "rotulo": "T1a" },
    { "valor": "T2a", "rotulo": "T2a" }
  ],
  "regras": [
    { "se": { "campo": "tamanho_t", "menorOuIgual": 1 }, "resultado": "T1a" },
    { "se": { "campo": "pleura", "em": ["pl1", "pl2"] }, "resultado": "T2a" }
  ]
}
```

- Entre as regras satisfeitas, vence a opção que estiver mais adiante em `opcoes`. Por isso as opções de estadiamento devem estar em ordem crescente.
- Uma regra com `"exclusivo": true` encerra a avaliação na hora (usada para Tis, T1mi e T0).
- A sugestão aparece com borda tracejada. O usuário pode marcar outro valor, e o campo passa a indicar "definido manualmente".
- `variaveis` (na raiz do template) criam valores numéricos auxiliares: `primeiroDe` devolve o primeiro campo numérico preenchido, multiplicado por `fator`. No pulmão, `tamanho_t` usa a medida invasiva (mm × 0,1) e, na falta dela, o tamanho total (cm).
- `linhaFinal` (na raiz, opcional) acrescenta uma última linha com marcadores `{id}`, por exemplo `"pTNM: {pT} {pN} {pM}"`.

Todo conteúdo médico de um template novo deve ser revisado por um patologista antes do merge.
