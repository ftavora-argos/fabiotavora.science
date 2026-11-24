#!/usr/bin/env node
// Valida os templates de assets/sinoptico/templates contra schema.json e
// confere as referências internas (ids, condições, regras). Sem dependências.
// Uso: node bin/validar-sinoptico.mjs

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "sinoptico");
const dirTemplates = join(raiz, "templates");
const lerJson = (caminho) => JSON.parse(readFileSync(caminho, "utf8"));
const schema = lerJson(join(raiz, "schema.json"));

// ---- Validador de um subconjunto de JSON Schema (o que o schema.json usa) ----
const tipoDe = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

function validar(valor, esquema, caminho, erros) {
  if (esquema.$ref) {
    const nome = esquema.$ref.replace("#/$defs/", "");
    return validar(valor, schema.$defs[nome], caminho, erros);
  }
  if (esquema.enum && !esquema.enum.includes(valor)) erros.push(`${caminho}: valor "${valor}" fora de [${esquema.enum.join(", ")}]`);
  if (esquema.type && tipoDe(valor) !== esquema.type) {
    erros.push(`${caminho}: esperado ${esquema.type}, encontrado ${tipoDe(valor)}`);
    return;
  }
  if (typeof valor === "string") {
    if (esquema.minLength && valor.length < esquema.minLength) erros.push(`${caminho}: texto vazio`);
    if (esquema.pattern && !new RegExp(esquema.pattern).test(valor)) erros.push(`${caminho}: "${valor}" não segue o padrão ${esquema.pattern}`);
  }
  if (Array.isArray(valor)) {
    if (esquema.minItems && valor.length < esquema.minItems) erros.push(`${caminho}: lista com menos de ${esquema.minItems} item(ns)`);
    if (esquema.items) valor.forEach((item, i) => validar(item, esquema.items, `${caminho}[${i}]`, erros));
  }
  if (tipoDe(valor) === "object") {
    for (const chave of esquema.required || []) if (!(chave in valor)) erros.push(`${caminho}: falta a propriedade "${chave}"`);
    for (const [chave, v] of Object.entries(valor)) {
      const sub = esquema.properties && esquema.properties[chave];
      if (sub) validar(v, sub, `${caminho}.${chave}`, erros);
      else if (esquema.additionalProperties === false) erros.push(`${caminho}: propriedade desconhecida "${chave}"`);
    }
  }
}

// ---- Conferências que o schema não cobre ----
const OPERADORES_NUMERICOS = ["maiorQue", "maiorOuIgual", "menorQue", "menorOuIgual"];

function conferirReferencias(tpl, erros) {
  const campos = new Map();
  const variaveis = new Set();
  for (const v of tpl.variaveis || []) {
    if (variaveis.has(v.id)) erros.push(`variável duplicada: ${v.id}`);
    variaveis.add(v.id);
  }
  for (const secao of tpl.secoes) {
    for (const campo of secao.campos) {
      if (campos.has(campo.id) || variaveis.has(campo.id)) erros.push(`id duplicado: ${campo.id}`);
      campos.set(campo.id, campo);
    }
  }
  const existe = (id) => campos.has(id) || variaveis.has(id);

  function conferirCondicao(c, onde) {
    for (const sub of [...(c.todos || []), ...(c.algum || []), ...(c.nao ? [c.nao] : [])]) conferirCondicao(sub, onde);
    const temOperador = Object.keys(c).some((k) => !["todos", "algum", "nao", "campo"].includes(k));
    if (!c.campo) {
      if (temOperador) erros.push(`${onde}: condição com operador, mas sem "campo"`);
      if (!c.todos && !c.algum && !c.nao) erros.push(`${onde}: condição vazia`);
      return;
    }
    if (!temOperador) erros.push(`${onde}: condição sobre "${c.campo}" sem operador`);
    if (!existe(c.campo)) return erros.push(`${onde}: condição aponta para campo inexistente "${c.campo}"`);
    const alvo = campos.get(c.campo);
    const valores = [
      ...(c.igual !== undefined ? [c.igual] : []),
      ...(c.em || []),
      ...(c.naoEm || []),
      ...(c.contem || []),
      ...((c.contagemDe && c.contagemDe.valores) || []),
    ];
    if (valores.length) {
      if (!alvo || !alvo.opcoes) return erros.push(`${onde}: "${c.campo}" não tem opções para comparar`);
      const validos = new Set(alvo.opcoes.map((o) => o.valor).concat(["__outro__", "__na__"]));
      for (const v of valores) if (!validos.has(v)) erros.push(`${onde}: "${v}" não é opção de "${c.campo}"`);
    }
    if (OPERADORES_NUMERICOS.some((op) => op in c) && alvo && !["numero", "derivado"].includes(alvo.tipo))
      erros.push(`${onde}: comparação numérica sobre campo não numérico "${c.campo}"`);
    if (("contagemMin" in c || "contagemMax" in c || "contagemDe" in c) && (!alvo || alvo.tipo !== "multipla"))
      erros.push(`${onde}: contagem sobre campo que não é de múltipla escolha "${c.campo}"`);
  }

  const FUNCOES = ["sqrt", "min", "max", "ou"];
  function conferirExpressao(texto, onde) {
    if (/[^A-Za-z0-9_+\-*/^(),. ]/.test(texto)) erros.push(`${onde}: expressão com caractere não permitido`);
    for (const [id] of texto.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      if (!FUNCOES.includes(id) && !existe(id)) erros.push(`${onde}: expressão usa id inexistente "${id}"`);
    }
    let aberto = 0;
    for (const ch of texto) aberto += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    if (aberto !== 0) erros.push(`${onde}: parênteses desbalanceados na expressão`);
  }

  for (const v of tpl.variaveis || []) {
    const formas = ["primeiroDe", "soma", "maiorDe", "expressao"].filter((k) => k in v);
    if (v.expressao) conferirExpressao(v.expressao, `variável ${v.id}`);
    if (formas.length !== 1) erros.push(`variável ${v.id}: use exatamente uma de primeiroDe, soma, maiorDe ou expressao`);
    for (const fonte of v.primeiroDe || []) {
      const alvo = campos.get(fonte.campo);
      if (!alvo) erros.push(`variável ${v.id}: campo inexistente "${fonte.campo}"`);
      else if (alvo.tipo !== "numero") erros.push(`variável ${v.id}: "${fonte.campo}" não é numérico`);
    }
    for (const id of [...(v.soma || []), ...(v.maiorDe || [])]) {
      const alvo = campos.get(id);
      if (!alvo) erros.push(`variável ${v.id}: campo inexistente "${id}"`);
      else if (alvo.tipo !== "numero" && !(alvo.opcoes || []).every((o) => /^[0-9]+$/.test(o.valor)))
        erros.push(`variável ${v.id}: "${id}" precisa ser numérico ou ter opções com valor numérico`);
    }
  }

  for (const campo of campos.values()) {
    const onde = `campo ${campo.id}`;
    const comOpcoes = ["unica", "multipla", "calculado"].includes(campo.tipo);
    if (comOpcoes && !campo.opcoes) erros.push(`${onde}: tipo "${campo.tipo}" exige "opcoes"`);
    if (!comOpcoes && campo.opcoes) erros.push(`${onde}: tipo "${campo.tipo}" não usa "opcoes"`);
    if (campo.tipo !== "calculado" && (campo.regras || campo.prefixo || campo.sufixo))
      erros.push(`${onde}: "regras" e "prefixo" só valem para tipo "calculado"`);
    if (campo.tipo === "derivado") {
      if (!campo.expressao) erros.push(`${onde}: tipo "derivado" exige "expressao"`);
      else conferirExpressao(campo.expressao, onde);
    } else if (campo.expressao) erros.push(`${onde}: "expressao" só vale para tipo "derivado"`);
    if (campo.tipo === "calculado" && !campo.regras) erros.push(`${onde}: tipo "calculado" exige "regras"`);
    if (campo.opcoes) {
      const vistos = new Set();
      for (const o of campo.opcoes) {
        if (vistos.has(o.valor)) erros.push(`${onde}: opção duplicada "${o.valor}"`);
        vistos.add(o.valor);
      }
      for (const r of campo.regras || []) {
        if (!vistos.has(r.resultado)) erros.push(`${onde}: regra com resultado "${r.resultado}" que não está nas opções`);
        conferirCondicao(r.se, `${onde}, regra ${r.resultado}`);
      }
    }
    for (const r of (campo.prefixo && campo.prefixo.regras) || []) conferirCondicao(r.se, `${onde}, prefixo`);
    for (const r of (campo.sufixo && campo.sufixo.regras) || []) conferirCondicao(r.se, `${onde}, sufixo`);
    for (const [, id] of (campo.rotuloLaudo || "").matchAll(/\{([A-Za-z0-9_]+)\}/g))
      if (!campos.has(id)) erros.push(`${onde}: rotuloLaudo aponta para campo inexistente "${id}"`);
    if (campo.visivelSe) conferirCondicao(campo.visivelSe, `${onde}, visivelSe`);
    if (campo.anexaEm) {
      if (!campos.has(campo.anexaEm)) erros.push(`${onde}: anexaEm aponta para campo inexistente "${campo.anexaEm}"`);
      if (!campo.formato) erros.push(`${onde}: anexaEm exige "formato"`);
    }
  }

  for (const [, id] of (tpl.linhaFinal || "").matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    if (!campos.has(id)) erros.push(`linhaFinal: campo inexistente "${id}"`);
  }
}

// ---- Execução ----
let falhas = 0;
const relatar = (nome, erros) => {
  if (erros.length === 0) return console.log(`ok     ${nome}`);
  falhas += 1;
  console.log(`ERRO   ${nome}`);
  for (const e of erros) console.log(`       - ${e}`);
};

const indice = lerJson(join(dirTemplates, "index.json"));
const errosIndice = [];
const listados = new Set();
for (const p of indice.protocolos || []) {
  for (const chave of ["id", "titulo", "orgao", "procedimento", "arquivo"]) if (!p[chave]) errosIndice.push(`protocolo sem "${chave}"`);
  if (listados.has(p.arquivo)) errosIndice.push(`arquivo repetido: ${p.arquivo}`);
  listados.add(p.arquivo);
  if (p.arquivo && !existsSync(join(dirTemplates, p.arquivo))) errosIndice.push(`arquivo não encontrado: ${p.arquivo}`);
}
if (!Array.isArray(indice.protocolos)) errosIndice.push('falta a lista "protocolos"');

for (const arquivo of readdirSync(dirTemplates).filter((a) => a.endsWith(".json") && a !== "index.json")) {
  const erros = [];
  let tpl;
  try {
    tpl = lerJson(join(dirTemplates, arquivo));
  } catch (e) {
    relatar(arquivo, [`JSON inválido: ${e.message}`]);
    continue;
  }
  validar(tpl, schema, "template", erros);
  if (erros.length === 0) conferirReferencias(tpl, erros);
  const entrada = (indice.protocolos || []).find((p) => p.arquivo === arquivo);
  if (!entrada) erros.push("não está listado em index.json");
  else if (tpl.meta && entrada.id !== tpl.meta.id) erros.push(`id em index.json ("${entrada.id}") difere de meta.id ("${tpl.meta.id}")`);
  relatar(arquivo, erros);
}
relatar("index.json", errosIndice);

process.exit(falhas ? 1 : 0);
