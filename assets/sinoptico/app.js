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

  // ---------- Expressões aritméticas (variáveis e campos derivados) ----------
  // Aceita números, + - * / ^, parênteses, ids de campos ou variáveis e as
  // funções sqrt, min, max e ou(a, b). Campo oculto vale 0; campo visível sem
  // resposta torna o resultado indefinido.
  var arvores = {};

  function analisar(texto) {
    if (arvores[texto]) return arvores[texto];
    var fichas = texto.match(/\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),]/g) || [];
    var i = 0;
    function primario() {
      var f = fichas[i++];
      if (f === "(") {
        var dentro = soma();
        i++;
        return dentro;
      }
      if (f === "-") return { op: "neg", a: potencia() };
      if (/^\d/.test(f)) return { num: Number(f) };
      if (fichas[i] === "(") {
        i++;
        var args = [];
        while (fichas[i] !== ")" && i < fichas.length) {
          args.push(soma());
          if (fichas[i] === ",") i++;
        }
        i++;
        return { fn: f, args: args };
      }
      return { id: f };
    }
    function potencia() {
      var base = primario();
      if (fichas[i] === "^") {
        i++;
        return { op: "^", a: base, b: potencia() };
      }
      return base;
    }
    function produto() {
      var no = potencia();
      while (fichas[i] === "*" || fichas[i] === "/") no = { op: fichas[i++], a: no, b: potencia() };
      return no;
    }
    function soma() {
      var no = produto();
      while (fichas[i] === "+" || fichas[i] === "-") no = { op: fichas[i++], a: no, b: produto() };
      return no;
    }
    arvores[texto] = soma();
    return arvores[texto];
  }

  function numeroDe(id) {
    var campo = estado.campos[id];
    if (campo) return visivel(campo) ? numero(valor(id)) : 0;
    var v = variavel(id);
    return v === undefined ? NaN : v;
  }

  function calcular(no) {
    if ("num" in no) return no.num;
    if ("id" in no) return numeroDe(no.id);
    if (no.fn) {
      var args = no.args.map(calcular);
      if (no.fn === "ou") return isNaN(args[0]) ? args[1] : args[0];
      if (no.fn === "sqrt") return Math.sqrt(args[0]);
      if (no.fn === "min") return Math.min.apply(null, args);
      if (no.fn === "max") return Math.max.apply(null, args);
      return NaN;
    }
    var a = calcular(no.a);
    if (no.op === "neg") return -a;
    var b = calcular(no.b);
    if (no.op === "+") return a + b;
    if (no.op === "-") return a - b;
    if (no.op === "*") return a * b;
    if (no.op === "/") return a / b;
    return Math.pow(a, b);
  }

  function avaliar(texto) {
    var chave = "e:" + texto;
    if (!(chave in cache)) {
      cache[chave] = NaN; // evita laço em referência circular
      var r = calcular(analisar(texto));
      cache[chave] = isFinite(r) ? r : NaN;
    }
    return cache[chave];
  }

  // Valor de um campo ou variável para uso em condições.
  function valor(id) {
    var campo = estado.campos[id];
    if (!campo) return variavel(id);
    if (!visivel(campo)) return undefined;
    if (campo.tipo === "calculado") return efetivo(campo);
    if (campo.tipo === "derivado") {
      var d = avaliar(campo.expressao);
      return isNaN(d) ? undefined : d;
    }
    return estado.resp[id];
  }

  function variavel(id) {
    var def = estado.variaveis[id];
    if (!def) return undefined;
    if (def.expressao) {
      var e = avaliar(def.expressao);
      return isNaN(e) ? undefined : e;
    }
    if (def.soma || def.maiorDe) {
      var nums = (def.soma || def.maiorDe).map(function (c) {
        return numero(valor(c));
      });
      if (def.soma) {
        return nums.some(isNaN)
          ? undefined
          : nums.reduce(function (a, b) {
              return a + b;
            }, 0);
      }
      nums = nums.filter(function (n) {
        return !isNaN(n);
      });
      return nums.length ? Math.max.apply(null, nums) : undefined;
    }
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

  function afixo(def) {
    if (!def) return "";
    var regras = def.regras || [];
    for (var i = 0; i < regras.length; i++) if (condicao(regras[i].se)) return regras[i].valor;
    return def.padrao;
  }

  function prefixo(campo) {
    return afixo(campo.prefixo);
  }

  function sufixo(campo) {
    return afixo(campo.sufixo);
  }

  // Rótulo da linha no laudo. Aceita {id} para usar o texto de outro campo.
  function rotuloNoLaudo(campo) {
    var base = campo.rotuloLaudo || campo.rotulo;
    if (base.indexOf("{") < 0) return base;
    var faltou = false;
    var r = base.replace(/\{([A-Za-z0-9_]+)\}/g, function (_, id) {
      var outro = estado.campos[id];
      var t = outro && visivel(outro) ? textoCampo(outro) : null;
      if (t === null) faltou = true;
      return t || "";
    });
    return faltou ? campo.rotulo : r;
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
      t = partes.length && partes.indexOf(null) < 0 ? partes.join(campo.separador || ", ") : null;
    } else if (campo.tipo === "numero") {
      if (!isNaN(numero(bruto))) {
        t = String(bruto).trim().replace(".", ",");
        if (campo.unidade) t += (campo.unidade === "%" ? "" : " ") + campo.unidade;
      }
    } else if (campo.tipo === "texto") {
      t = (bruto || "").trim() || null;
    } else if (campo.tipo === "derivado") {
      var d = avaliar(campo.expressao);
      if (!isNaN(d)) {
        t = d.toFixed(campo.decimais || 0).replace(".", ",");
        if (campo.unidade) t += (campo.unidade === "%" ? "" : " ") + campo.unidade;
      }
    } else if (campo.tipo === "calculado") {
      var v = efetivo(campo);
      t = v ? prefixo(campo) + textoOpcao(campo, v) + sufixo(campo) : null;
    }
    return t;
  }

  function comFormato(campo, t) {
    var formato = campo.formatoUm && numero(estado.resp[campo.id]) === 1 ? campo.formatoUm : campo.formato;
    return formato ? formato.replace("{valor}", t) : t;
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
          t = comFormato(campo, PENDENTE);
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
        if (campo.sufixoLaudo) t += campo.sufixoLaudo;
        if (campo.semRotulo) {
          t.split("\n").forEach(function (linha) {
            if (linha.trim()) linhas.push({ texto: linha.trim(), falta: falta });
          });
        } else {
          linhas.push({ texto: rotuloNoLaudo(campo) + ": " + t, falta: falta });
        }
      });
      if (!linhas.length) return;
      if ((secao.espacoAntes === undefined ? !!secao.cabecalhoLaudo : secao.espacoAntes) && saida.length) saida.push({ texto: "", falta: false });
      if (secao.cabecalhoLaudo) saida.push({ texto: secao.cabecalhoLaudo, falta: false, destaque: !!secao.cabecalhoDestaque });
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
    } else if (campo.tipo === "derivado") {
      refs.resultado = el("p", { class: "resultado", "aria-live": "polite" });
      caixa.appendChild(refs.resultado);
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
          refs.resultado.appendChild(el("strong", { text: prefixo(campo) + textoOpcao(campo, sug) + sufixo(campo) }));
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
              atual ? "Valor definido manualmente: " + prefixo(campo) + textoOpcao(campo, atual) + sufixo(campo) + "." : "Valor removido manualmente."
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
    } else if (campo.tipo === "derivado") {
      var td = textoCampo(campo);
      refs.resultado.textContent = "";
      if (td === null) {
        refs.resultado.textContent = campo.semSugestao || "Aguardando os dados para o cálculo.";
      } else {
        refs.resultado.appendChild(document.createTextNode("Calculado automaticamente:"));
        refs.resultado.appendChild(el("strong", { text: td }));
      }
    } else if (campo.tipo === "numero") {
      var bruto = (estado.resp[campo.id] || "").trim();
      refs.entrada.setAttribute("aria-invalid", bruto !== "" && isNaN(numero(bruto)) ? "true" : "false");
    }
  }

  function atualizar() {
    cache = {};
    estado.ordem.forEach(atualizarCampo);
    // seção sem nenhum campo visível some do formulário
    (estado.blocos || []).forEach(function (b) {
      b.no.hidden = !b.campos.some(visivel);
    });

    var faltam = pendentes();
    var contador = estado.ui.contador;
    contador.classList.toggle("completo", faltam.length === 0);
    contador.disabled = faltam.length === 0;
    contador.textContent =
      faltam.length === 0 ? "Obrigatórios preenchidos" : faltam.length === 1 ? "1 obrigatório pendente" : faltam.length + " obrigatórios pendentes";

    var previa = estado.ui.previa;
    previa.textContent = "";
    linhasDoLaudo().forEach(function (l) {
      previa.appendChild(el("span", { class: l.falta ? "falta" : l.destaque ? "destaque" : "", text: l.texto }));
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

  function escaparHtml(t) {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Versão formatada do laudo (negrito e sublinhado nos cabeçalhos marcados).
  function htmlDoLaudo() {
    return (
      "<div>" +
      linhasDoLaudo()
        .map(function (l) {
          var t = escaparHtml(l.texto);
          return l.destaque ? "<b><u>" + t + "</u></b>" : t;
        })
        .join("<br>") +
      "</div>"
    );
  }

  // Copia texto puro e, junto, a versão formatada. Editores que aceitam
  // formatação recebem o negrito e o sublinhado; os demais recebem o texto puro.
  function copiar() {
    var texto = textoDoLaudo();
    var html = htmlDoLaudo();
    var faltam = pendentes().length;
    var msg = faltam ? "Laudo copiado, com " + faltam + " item(ns) obrigatório(s) pendente(s)." : "Laudo copiado.";
    function reserva() {
      var caixa = el("div", { contenteditable: "true", style: "position:fixed;top:0;left:0;opacity:0;white-space:pre-wrap" });
      caixa.innerHTML = html;
      document.body.appendChild(caixa);
      var faixa = document.createRange();
      faixa.selectNodeContents(caixa);
      var selecao = window.getSelection();
      selecao.removeAllRanges();
      selecao.addRange(faixa);
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      selecao.removeAllRanges();
      caixa.remove();
      avisar(ok ? msg : "Não foi possível copiar. Selecione o texto da prévia e copie manualmente.");
    }
    function soTexto() {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(function () {
          avisar(msg);
        }, reserva);
      } else {
        reserva();
      }
    }
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
      var item = new window.ClipboardItem({
        "text/plain": new Blob([texto], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      });
      navigator.clipboard.write([item]).then(function () {
        avisar(msg);
      }, soTexto);
    } else {
      soTexto();
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
      (estado.blocos = estado.blocos || []).push({ no: bloco, campos: secao.campos });
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
