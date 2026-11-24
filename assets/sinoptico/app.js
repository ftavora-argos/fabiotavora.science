/*
 * Gerador de laudos sinópticos.
 * Motor genérico: lê um template JSON (ver schema.json) e monta formulário,
 * prévia e texto do laudo. Não há nenhuma regra de tumor neste arquivo.
 * Nada é salvo nem enviado: o estado vive só na memória da página.
 */
(function () {
  "use strict";

  var OUTRO = "__outro__";
  var NA = "__na__";
  var PENDENTE = "[PREENCHER]";
  var TEXTO_NA = "não avaliável";

  var app = document.getElementById("app");
  var statusEl = document.getElementById("status");
  var estado = null;
  var cache = {};

  // ---------- Utilidades ----------

  function el(tag, attrs, filhos) {
    var no = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") no.textContent = attrs[k];
      else if (k === "class") no.className = attrs[k];
      else no.setAttribute(k, attrs[k]);
    });
    (filhos || []).forEach(function (f) {
      if (f) no.appendChild(f);
    });
    return no;
  }

  function semAcento(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function numero(v) {
    if (typeof v === "number") return v;
    if (v === undefined || v === null) return NaN;
    var s = String(v).trim().replace(",", ".");
    if (s === "" || !/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
    return Number(s);
  }

  var timerStatus = null;
  function avisar(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add("visivel");
    clearTimeout(timerStatus);
    timerStatus = setTimeout(function () {
      statusEl.classList.remove("visivel");
    }, 2200);
  }

  // ---------- Tema (segue o site; só leitura) ----------

  function aplicarTema() {
    var tema = null;
    try {
      if (window.parent !== window) tema = window.parent.document.documentElement.getAttribute("data-theme");
    } catch (e) {
      tema = null;
    }
    if (tema !== "dark" && tema !== "light") {
      try {
        tema = window.localStorage.getItem("theme");
      } catch (e) {
        tema = null;
      }
    }
    if (tema !== "dark" && tema !== "light") tema = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", tema);
  }

  function observarTema() {
    aplicarTema();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", aplicarTema);
    window.addEventListener("storage", aplicarTema);
    try {
      if (window.parent !== window) {
        new MutationObserver(aplicarTema).observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      }
    } catch (e) {
      /* iframe em outra origem: fica com a preferência do sistema */
    }
  }

  // ---------- Avaliação do template ----------

  function visivel(campo) {
    if (!campo.visivelSe) return true;
    var chave = "v:" + campo.id;
    if (!(chave in cache)) {
      cache[chave] = false; // evita laço em referência circular
      cache[chave] = condicao(campo.visivelSe);
    }
    return cache[chave];
  }

  // Valor de um campo ou variável para uso em condições.
  function valor(id) {
    var campo = estado.campos[id];
    if (!campo) return variavel(id);
    if (!visivel(campo)) return undefined;
    if (campo.tipo === "calculado") return efetivo(campo);
    return estado.resp[id];
  }

  function variavel(id) {
    var def = estado.variaveis[id];
    if (!def) return undefined;
    for (var i = 0; i < def.primeiroDe.length; i++) {
      var n = numero(valor(def.primeiroDe[i].campo));
      if (!isNaN(n)) return n * (def.primeiroDe[i].fator === undefined ? 1 : def.primeiroDe[i].fator);
    }
    return undefined;
  }

  function condicao(c) {
    if (c.todos && !c.todos.every(condicao)) return false;
    if (c.algum && !c.algum.some(condicao)) return false;
    if (c.nao && condicao(c.nao)) return false;
    if (!c.campo) return true;

    var v = valor(c.campo);
    var lista = Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [String(v)];
    var algumEm = function (alvos) {
      return lista.some(function (x) {
        return alvos.indexOf(x) >= 0;
      });
    };
    if (c.igual !== undefined && lista.indexOf(c.igual) < 0) return false;
    if (c.em && !algumEm(c.em)) return false;
    if (c.naoEm && algumEm(c.naoEm)) return false;
    if (c.contem && !algumEm(c.contem)) return false;
    if (c.contagemMin !== undefined && lista.length < c.contagemMin) return false;
    if (c.contagemMax !== undefined && lista.length > c.contagemMax) return false;
    if (c.contagemDe) {
      var qtd = lista.filter(function (x) {
        return c.contagemDe.valores.indexOf(x) >= 0;
      }).length;
      if (c.contagemDe.min !== undefined && qtd < c.contagemDe.min) return false;
      if (c.contagemDe.max !== undefined && qtd > c.contagemDe.max) return false;
    }
    if (c.preenchido !== undefined && lista.length > 0 !== c.preenchido) return false;

    var numerica = c.maiorQue !== undefined || c.maiorOuIgual !== undefined || c.menorQue !== undefined || c.menorOuIgual !== undefined;
    if (numerica) {
      var n = numero(v);
      if (isNaN(n)) return false;
      if (c.maiorQue !== undefined && !(n > c.maiorQue)) return false;
      if (c.maiorOuIgual !== undefined && !(n >= c.maiorOuIgual)) return false;
      if (c.menorQue !== undefined && !(n < c.menorQue)) return false;
      if (c.menorOuIgual !== undefined && !(n <= c.menorOuIgual)) return false;
    }
    return true;
  }

  // Sugestão de um campo calculado. Regra "exclusivo" encerra a busca; entre as
  // demais regras satisfeitas, vence a opção mais adiante na lista de opções.
  function sugestao(campo) {
    var chave = "s:" + campo.id;
    if (chave in cache) return cache[chave];
    cache[chave] = null;
    var ordem = campo.opcoes.map(function (o) {
      return o.valor;
    });
    var melhor = -1;
    for (var i = 0; i < campo.regras.length; i++) {
      var regra = campo.regras[i];
      if (!condicao(regra.se)) continue;
      var pos = ordem.indexOf(regra.resultado);
      if (regra.exclusivo) {
        melhor = pos;
        break;
      }
      if (pos > melhor) melhor = pos;
    }
    cache[chave] = melhor >= 0 ? ordem[melhor] : null;
    return cache[chave];
  }

  function efetivo(campo) {
    var manual = estado.manual[campo.id];
    if (manual !== undefined) return manual || null;
    return sugestao(campo);
  }

  function prefixo(campo) {
    if (!campo.prefixo) return "";
    var regras = campo.prefixo.regras || [];
    for (var i = 0; i < regras.length; i++) if (condicao(regras[i].se)) return regras[i].valor;
    return campo.prefixo.padrao;
  }

  function textoOpcao(campo, v) {
    if (v === NA) return TEXTO_NA;
    if (v === OUTRO) return (estado.outros[campo.id] || "").trim() || null;
    for (var i = 0; i < campo.opcoes.length; i++) if (campo.opcoes[i].valor === v) return campo.opcoes[i].texto || campo.opcoes[i].rotulo;
    return null;
  }

  // Texto que o campo gera no laudo, ou null se não respondido.
  function textoCampo(campo) {
    var bruto = estado.resp[campo.id];
    var t = null;
    if (campo.tipo === "unica") {
      t = bruto ? textoOpcao(campo, bruto) : null;
    } else if (campo.tipo === "multipla") {
      var partes = (bruto || []).map(function (v) {
        return textoOpcao(campo, v);
      });
      t = partes.length && partes.indexOf(null) < 0 ? partes.join(", ") : null;
    } else if (campo.tipo === "numero") {
      if (!isNaN(numero(bruto))) {
        t = String(bruto).trim().replace(".", ",");
        if (campo.unidade) t += (campo.unidade === "%" ? "" : " ") + campo.unidade;
      }
    } else if (campo.tipo === "texto") {
      t = (bruto || "").trim() || null;
    } else if (campo.tipo === "calculado") {
      var v = efetivo(campo);
      t = v ? prefixo(campo) + textoOpcao(campo, v) : null;
    }
    return t;
  }

  function comFormato(campo, t) {
    return campo.formato ? campo.formato.replace("{valor}", t) : t;
  }

  function pendentes() {
    return estado.ordem.filter(function (campo) {
      return campo.nucleo && visivel(campo) && textoCampo(campo) === null;
    });
  }

  // Linhas do laudo: [{ texto, falta }]
  function linhasDoLaudo() {
    var saida = [];
    estado.tpl.secoes.forEach(function (secao) {
      var linhas = [];
      secao.campos.forEach(function (campo) {
        if (!visivel(campo) || campo.omitirNoLaudo || campo.anexaEm) return;
        var t = textoCampo(campo);
        var falta = false;
        if (t === null) {
          if (!campo.nucleo) return;
          t = PENDENTE;
          falta = true;
        } else {
          t = comFormato(campo, t);
        }
        (estado.anexos[campo.id] || []).forEach(function (anexo) {
          if (!visivel(anexo)) return;
          var ta = textoCampo(anexo);
          if (ta === null && !anexo.nucleo) return;
          if (ta === null) falta = true;
          t += comFormato(anexo, ta === null ? PENDENTE : ta);
        });
        if (campo.semRotulo) {
          t.split("\n").forEach(function (linha) {
            if (linha.trim()) linhas.push({ texto: linha.trim(), falta: falta });
          });
        } else {
          linhas.push({ texto: (campo.rotuloLaudo || campo.rotulo) + ": " + t, falta: falta });
        }
      });
      if (!linhas.length) return;
      if (secao.cabecalhoLaudo) {
        if (saida.length) saida.push({ texto: "", falta: false });
        saida.push({ texto: secao.cabecalhoLaudo, falta: false });
      }
      saida = saida.concat(linhas);
    });
    if (estado.tpl.linhaFinal) {
      var falta = false;
      var final = estado.tpl.linhaFinal.replace(/\{([A-Za-z0-9_]+)\}/g, function (_, id) {
        var campo = estado.campos[id];
        var t = campo && visivel(campo) ? textoCampo(campo) : null;
        if (t === null && campo && campo.nucleo) {
          falta = true;
          return PENDENTE;
        }
        return t || "";
      });
      saida.push({ texto: final.replace(/\s+/g, " ").trim(), falta: falta });
    }
    return saida;
  }

  function textoDoLaudo() {
    return linhasDoLaudo()
      .map(function (l) {
        return l.texto;
      })
      .join("\n");
  }

  // ---------- Formulário ----------

  function criarChip(campo, v, rotulo) {
    return el("button", { type: "button", class: "chip", "aria-pressed": "false", "data-valor": v, tabindex: "-1", text: rotulo });
  }

  function aoClicarChip(campo, v) {
    var id = campo.id;
    if (campo.tipo === "calculado") {
      estado.manual[id] = efetivo(campo) === v ? "" : v;
      if (estado.manual[id] === (sugestaoAtual(campo) || "")) delete estado.manual[id];
    } else if (campo.tipo === "unica") {
      estado.resp[id] = estado.resp[id] === v ? undefined : v;
    } else {
      var atual = (estado.resp[id] || []).slice();
      var pos = atual.indexOf(v);
      var exclusiva =
        v === NA ||
        campo.opcoes.some(function (o) {
          return o.valor === v && o.exclusiva;
        });
      if (pos >= 0) atual.splice(pos, 1);
      else if (exclusiva) atual = [v];
      else {
        atual = atual.filter(function (x) {
          return (
            x !== NA &&
            !campo.opcoes.some(function (o) {
              return o.valor === x && o.exclusiva;
            })
          );
        });
        atual.push(v);
        // mantém a ordem das opções do template no texto do laudo
        var ordem = campo.opcoes
          .map(function (o) {
            return o.valor;
          })
          .concat([OUTRO, NA]);
        atual.sort(function (a, b) {
          return ordem.indexOf(a) - ordem.indexOf(b);
        });
      }
      estado.resp[id] = atual;
    }
    atualizar();
    if (v === OUTRO && estado.els[id].outro && !estado.els[id].outro.hidden) estado.els[id].outro.focus();
  }

  function sugestaoAtual(campo) {
    cache = {};
    return sugestao(campo);
  }

  function navegarChips(ev, grupo) {
    var teclas = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(ev.key in teclas) && ev.key !== "Home" && ev.key !== "End") return;
    var chips = Array.prototype.slice.call(grupo.querySelectorAll(".chip"));
    var i = chips.indexOf(document.activeElement);
    if (i < 0) return;
    ev.preventDefault();
    var alvo = ev.key === "Home" ? 0 : ev.key === "End" ? chips.length - 1 : (i + teclas[ev.key] + chips.length) % chips.length;
    chips.forEach(function (c, k) {
      c.setAttribute("tabindex", k === alvo ? "0" : "-1");
    });
    chips[alvo].focus();
  }

  function criarCampo(campo) {
    var idRotulo = "rot-" + campo.id;
    var marca = el("span", { class: "marca-campo" });
    var rotulo = el("div", { class: "rotulo", id: idRotulo }, [document.createTextNode(campo.rotulo), marca]);
    var caixa = el("div", { class: "campo", "data-id": campo.id }, [rotulo]);
    var refs = { caixa: caixa, marca: marca, chips: [], outro: null, entrada: null, sugestao: null };
    if (campo.ajuda) caixa.appendChild(el("p", { class: "ajuda", text: campo.ajuda }));

    if (campo.opcoes) {
      var grupo = el("div", { class: "chips", role: "group", "aria-labelledby": idRotulo });
      campo.opcoes.forEach(function (o) {
        grupo.appendChild(criarChip(campo, o.valor, o.rotulo));
      });
      if (campo.permiteOutro) grupo.appendChild(criarChip(campo, OUTRO, "outro (especificar)"));
      if (campo.permiteNaoAvaliavel) grupo.appendChild(criarChip(campo, NA, TEXTO_NA));
      refs.chips = Array.prototype.slice.call(grupo.children);
      grupo.addEventListener("click", function (ev) {
        var chip = ev.target.closest(".chip");
        if (chip) aoClicarChip(campo, chip.getAttribute("data-valor"));
      });
      grupo.addEventListener("keydown", function (ev) {
        navegarChips(ev, grupo);
      });
      caixa.appendChild(grupo);
      if (campo.permiteOutro) {
        refs.outro = el("input", { type: "text", class: "outro", hidden: "", "aria-label": campo.rotulo + ": especificar", autocomplete: "off" });
        refs.outro.addEventListener("input", function () {
          estado.outros[campo.id] = refs.outro.value;
          atualizar();
        });
        caixa.appendChild(refs.outro);
      }
      if (campo.tipo === "calculado") {
        // O resultado calculado vem primeiro; os botões só abrem para ajuste manual.
        refs.grupo = grupo;
        refs.resultado = el("p", { class: "resultado", "aria-live": "polite" });
        caixa.insertBefore(refs.resultado, grupo);
        refs.sugestao = el("p", { class: "sugestao" });
        caixa.appendChild(refs.sugestao);
      }
    } else {
      var attrs = { "aria-labelledby": idRotulo, autocomplete: "off" };
      if (campo.tipo === "numero") {
        attrs.type = "text";
        attrs.inputmode = "decimal";
        attrs.class = "numero";
        refs.entrada = el("input", attrs);
      } else if (campo.multilinha) {
        refs.entrada = el("textarea", attrs);
      } else {
        attrs.type = "text";
        attrs.class = "texto";
        refs.entrada = el("input", attrs);
      }
      refs.entrada.addEventListener("input", function () {
        estado.resp[campo.id] = refs.entrada.value;
        atualizar();
      });
      var linha = el("div", { class: "entrada" }, [refs.entrada]);
      if (campo.unidade) linha.appendChild(el("span", { class: "unidade", text: campo.unidade }));
      caixa.appendChild(linha);
    }
    estado.els[campo.id] = refs;
    return caixa;
  }

  function atualizarCampo(campo) {
    var refs = estado.els[campo.id];
    var mostra = visivel(campo);
    refs.caixa.hidden = !mostra;
    if (!mostra) return;

    var falta = campo.nucleo && textoCampo(campo) === null;
    refs.caixa.classList.toggle("pendente", !!falta);
    refs.marca.textContent = falta ? "pendente" : campo.nucleo ? "" : "opcional";

    if (campo.opcoes) {
      var sug = campo.tipo === "calculado" ? sugestao(campo) : null;
      var selecionados =
        campo.tipo === "calculado" ? [efetivo(campo)] : campo.tipo === "unica" ? [estado.resp[campo.id]] : estado.resp[campo.id] || [];
      var temFoco = false;
      refs.chips.forEach(function (chip) {
        var v = chip.getAttribute("data-valor");
        var ligado = selecionados.indexOf(v) >= 0;
        chip.setAttribute("aria-pressed", ligado ? "true" : "false");
        chip.classList.toggle("sugerido", sug !== null && v === sug);
        if (chip.getAttribute("tabindex") === "0") temFoco = true;
      });
      if (!temFoco) {
        var primeiro =
          refs.chips.filter(function (c) {
            return c.getAttribute("aria-pressed") === "true";
          })[0] || refs.chips[0];
        primeiro.setAttribute("tabindex", "0");
      }
      if (refs.outro) refs.outro.hidden = selecionados.indexOf(OUTRO) < 0;
      if (refs.sugestao) {
        var manual = estado.manual[campo.id] !== undefined;
        var aberto = manual || refs.aberto || (sug === null && !!campo.nucleo);
        refs.grupo.hidden = !aberto;
        refs.resultado.textContent = "";
        if (sug) {
          refs.resultado.appendChild(document.createTextNode("Calculado automaticamente:"));
          refs.resultado.appendChild(el("strong", { text: prefixo(campo) + textoOpcao(campo, sug) }));
        } else {
          refs.resultado.textContent = campo.semSugestao || "Sem cálculo automático com os dados atuais.";
        }
        refs.sugestao.textContent = "";
        var acao = function (rotulo, fn) {
          var botao = el("button", { type: "button", class: "link", text: rotulo });
          botao.addEventListener("click", fn);
          refs.sugestao.appendChild(botao);
        };
        if (manual) {
          var atual = efetivo(campo);
          refs.sugestao.appendChild(
            document.createTextNode(
              atual ? "Valor definido manualmente: " + prefixo(campo) + textoOpcao(campo, atual) + "." : "Valor removido manualmente."
            )
          );
          acao("voltar ao cálculo", function () {
            delete estado.manual[campo.id];
            refs.aberto = false;
            atualizar();
          });
        } else if (!aberto) {
          acao("alterar manualmente", function () {
            refs.aberto = true;
            atualizar();
            (refs.grupo.querySelector('.chip[tabindex="0"]') || refs.chips[0]).focus();
          });
        }
      }
    } else if (campo.tipo === "numero") {
      var bruto = (estado.resp[campo.id] || "").trim();
      refs.entrada.setAttribute("aria-invalid", bruto !== "" && isNaN(numero(bruto)) ? "true" : "false");
    }
  }

  function atualizar() {
    cache = {};
    estado.ordem.forEach(atualizarCampo);

    var faltam = pendentes();
    var contador = estado.ui.contador;
    contador.classList.toggle("completo", faltam.length === 0);
    contador.disabled = faltam.length === 0;
    contador.textContent =
      faltam.length === 0 ? "Obrigatórios preenchidos" : faltam.length === 1 ? "1 obrigatório pendente" : faltam.length + " obrigatórios pendentes";

    var previa = estado.ui.previa;
    previa.textContent = "";
    linhasDoLaudo().forEach(function (l) {
      previa.appendChild(el("span", { class: l.falta ? "falta" : "", text: l.texto }));
      previa.appendChild(document.createTextNode("\n"));
    });
  }

  function irParaPendente() {
    var faltam = pendentes();
    if (!faltam.length) return;
    var refs = estado.els[faltam[0].id];
    var alvo = refs.entrada || refs.caixa.querySelector('.chip[tabindex="0"]') || refs.chips[0];
    refs.caixa.scrollIntoView({ block: "center" });
    if (alvo) alvo.focus({ preventScroll: true });
  }

  function copiar() {
    var texto = textoDoLaudo();
    var faltam = pendentes().length;
    var msg = faltam ? "Laudo copiado, com " + faltam + " item(ns) obrigatório(s) pendente(s)." : "Laudo copiado.";
    function reserva() {
      var ta = el("textarea", { readonly: "", style: "position:fixed;top:0;left:0;opacity:0" });
      ta.value = texto;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      ta.remove();
      avisar(ok ? msg : "Não foi possível copiar. Selecione o texto da prévia e copie manualmente.");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () {
        avisar(msg);
      }, reserva);
    } else {
      reserva();
    }
  }

  function limpar(botao) {
    if (botao.getAttribute("data-confirmar") !== "1") {
      botao.setAttribute("data-confirmar", "1");
      botao.textContent = "Confirmar limpeza";
      setTimeout(function () {
        botao.removeAttribute("data-confirmar");
        botao.textContent = "Limpar";
      }, 3000);
      return;
    }
    mostrarProtocolo(estado.tpl);
    avisar("Formulário limpo.");
  }

  function mostrarProtocolo(tpl) {
    estado = { tpl: tpl, campos: {}, variaveis: {}, anexos: {}, ordem: [], resp: {}, outros: {}, manual: {}, els: {}, ui: {} };
    (tpl.variaveis || []).forEach(function (v) {
      estado.variaveis[v.id] = v;
    });
    tpl.secoes.forEach(function (secao) {
      secao.campos.forEach(function (campo) {
        estado.campos[campo.id] = campo;
        estado.ordem.push(campo);
        if (campo.anexaEm) (estado.anexos[campo.anexaEm] = estado.anexos[campo.anexaEm] || []).push(campo);
      });
    });

    var m = tpl.meta;
    var meta = [m.fonte, "versão " + m.versao, "revisão " + m.revisao.split("-").reverse().join("/")];
    if (m.estadiamento) meta.push(m.estadiamento);
    var cabecalho = el("div", { class: "cabecalho" }, [
      el("a", { class: "voltar", href: "#/", text: "← Todos os protocolos" }),
      el("h1", { text: m.titulo }),
      el("p", { class: "meta", text: meta.join(" · ") }),
    ]);

    var form = el("form", { class: "formulario", novalidate: "", "aria-label": "Formulário do laudo" });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
    });
    tpl.secoes.forEach(function (secao) {
      var bloco = el("section", { class: "secao" }, [el("h2", { text: secao.titulo })]);
      secao.campos.forEach(function (campo) {
        bloco.appendChild(criarCampo(campo));
      });
      form.appendChild(bloco);
    });

    var contador = el("button", { type: "button", class: "contador" });
    contador.addEventListener("click", irParaPendente);
    var btCopiar = el("button", { type: "button", class: "botao principal", text: "Copiar laudo" });
    btCopiar.addEventListener("click", copiar);
    var btLimpar = el("button", { type: "button", class: "botao", text: "Limpar" });
    btLimpar.addEventListener("click", function () {
      limpar(btLimpar);
    });
    var previa = el("pre", { class: "previa", tabindex: "0", "aria-label": "Prévia do laudo" });
    estado.ui = { contador: contador, previa: previa };

    var lado = el("aside", { class: "lado" }, [
      el("div", { class: "acoes" }, [el("h2", { text: "Prévia do laudo" }), contador, btLimpar, btCopiar]),
      previa,
    ]);

    app.textContent = "";
    app.appendChild(cabecalho);
    app.appendChild(el("div", { class: "colunas" }, [form, lado]));
    document.title = m.titulo + " · Laudos sinópticos";
    atualizar();
  }

  // ---------- Lista de protocolos e rotas ----------

  var indice = null;

  function buscarJson(caminho) {
    return fetch(caminho).then(function (r) {
      if (!r.ok) throw new Error(caminho + ": " + r.status);
      return r.json();
    });
  }

  function mostrarErro(msg) {
    app.textContent = "";
    app.appendChild(el("p", { class: "vazio", text: msg }));
  }

  function mostrarInicio() {
    estado = null;
    document.title = "Laudos sinópticos";
    var busca = el("input", {
      type: "search",
      class: "busca",
      placeholder: "Buscar por órgão, tumor ou procedimento",
      "aria-label": "Buscar protocolo",
      autocomplete: "off",
    });
    var lista = el("ul", { class: "lista" });
    function desenhar() {
      var termo = semAcento(busca.value.trim());
      lista.textContent = "";
      var achados = indice.protocolos.filter(function (p) {
        return semAcento([p.titulo, p.orgao, p.procedimento].join(" ")).indexOf(termo) >= 0;
      });
      achados.forEach(function (p) {
        lista.appendChild(
          el("li", {}, [
            el("a", { href: "#/" + p.id }, [
              el("span", { class: "lista-titulo", text: p.titulo }),
              el("span", { class: "lista-meta", text: p.orgao + " · " + p.procedimento }),
            ]),
          ])
        );
      });
      if (!achados.length) lista.appendChild(el("li", { class: "vazio", text: "Nenhum protocolo encontrado." }));
    }
    busca.addEventListener("input", desenhar);
    app.textContent = "";
    app.appendChild(el("div", { class: "inicio" }, [el("h1", { text: "Protocolos" }), busca, lista]));
    desenhar();
  }

  function rotear() {
    var id = decodeURIComponent(window.location.hash.replace(/^#\/?/, ""));
    if (!id) return mostrarInicio();
    var entrada = indice.protocolos.filter(function (p) {
      return p.id === id;
    })[0];
    if (!entrada) return mostrarInicio();
    buscarJson("templates/" + entrada.arquivo).then(mostrarProtocolo, function () {
      mostrarErro("Não foi possível carregar o protocolo.");
    });
  }

  observarTema();
  buscarJson("templates/index.json").then(
    function (dados) {
      indice = dados;
      window.addEventListener("hashchange", rotear);
      rotear();
    },
    function () {
      mostrarErro("Não foi possível carregar a lista de protocolos. Abra o app por um servidor HTTP (veja o README).");
    }
  );
})();
