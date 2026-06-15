#!/usr/bin/env python3
"""Append new publications to _bibliography/papers.bib from ORCID + Crossref.

Source of truth: the author's curated ORCID work list (public API, no auth).
For each work missing a DOI, attempt a Crossref title match; then fetch clean
BibTeX from doi.org. Existing entries are NEVER modified or reordered -- only
genuinely new publications (by DOI or fuzzy title) are appended. This keeps all
curated fields (selected, abbr, preview, ...) and the Scholar-citation pipeline
intact.
"""
import json, re, sys, time, urllib.request, urllib.parse

ORCID  = "0000-0003-2361-0613"
MAILTO = "fabiotavora@argospatologia.com.br"   # Crossref polite pool
BIB    = "_bibliography/papers.bib"

def get(url, accept=None, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": f"al-folio-pub-bot (mailto:{MAILTO})"})
    if accept: req.add_header("Accept", accept)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception:
        return ""

norm  = lambda s: re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()
toks  = lambda s: {w for w in norm(s).split() if len(w) > 3}

def split_entries(text):
    out, i = [], 0
    while True:
        at = text.find("@", i)
        if at < 0: break
        b = text.find("{", at); depth = 0; j = b
        while j < len(text):
            if text[j] == "{": depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0: break
            j += 1
        out.append(text[at:j + 1]); i = j + 1
    return out

def field(entry, name):
    m = re.search(name + r"\s*=\s*\{", entry, re.I)
    if not m:
        m2 = re.search(name + r'\s*=\s*"([^"]*)"', entry, re.I)
        return m2.group(1).strip() if m2 else None
    s = m.end(); depth = 1; j = s
    while j < len(entry) and depth > 0:
        if entry[j] == "{": depth += 1
        elif entry[j] == "}": depth -= 1
        j += 1
    return entry[s:j - 1].strip()

def orcid_works():
    d = json.loads(get(f"https://pub.orcid.org/v3.0/{ORCID}/works", "application/json", 30) or "{}")
    items = []
    for g in d.get("group", []):
        doi = next((e["external-id-value"] for e in g.get("external-ids", {}).get("external-id", [])
                    if e.get("external-id-type") == "doi"), None)
        ws = g["work-summary"][0]
        title = ((ws.get("title") or {}).get("title") or {}).get("value")
        year  = ((ws.get("publication-date") or {}).get("year") or {}).get("value")
        if title:
            items.append({"doi": doi, "title": title.strip(), "year": year})
    return items

def crossref_doi(title):
    url = ("https://api.crossref.org/works?rows=1&mailto=" + MAILTO +
           "&query.bibliographic=" + urllib.parse.quote(title))
    try:
        c = json.loads(get(url, timeout=15))["message"]["items"][0]
        ct = " ".join(c.get("title") or [])
        a, b = toks(title), toks(ct)
        if a and b and len(a & b) / len(a | b) >= 0.6:
            return c.get("DOI")
    except Exception:
        pass
    return None

def first_author_last(entry):
    a = field(entry, "author")
    if not a: return "ref"
    first = a.split(" and ")[0].strip()
    last = first.split(",")[0] if "," in first else (first.split()[-1] if first.split() else "ref")
    return re.sub(r"[^a-z]", "", last.lower()) or "ref"

def first_word(title):
    for w in norm(title).split():
        if len(w) > 3 and w not in ("with", "from", "that", "this", "using", "among"):
            return w
    return "study"

def main():
    existing_text = open(BIB).read()
    existing = split_entries(existing_text)
    ex_dois = {field(e, "doi").lower() for e in existing if field(e, "doi")}
    ex_titles = [toks(field(e, "title")) for e in existing if field(e, "title")]
    used_keys = {re.match(r"@\w+\{([^,]+),", e).group(1).strip() for e in existing if re.match(r"@\w+\{([^,]+),", e)}

    works = orcid_works()
    print(f"ORCID works: {len(works)}", file=sys.stderr)

    added = []
    for w in works:
        doi = w["doi"]
        if not doi:
            doi = crossref_doi(w["title"]); time.sleep(0.05)
        if doi and doi.lower() in ex_dois:
            continue
        tt = toks(w["title"])
        if any(tt and et and len(tt & et) / len(tt | et) >= 0.6 for et in ex_titles):
            continue
        bib = None
        if doi:
            bib = get("https://doi.org/" + doi, "application/x-bibtex", 15); time.sleep(0.05)
            if not (bib and bib.strip().startswith("@") and "title" in bib.lower()):
                bib = None
        if not bib:
            j = f'  journal={{{w.get("journal","")}}},\n' if w.get("journal") else ""
            bib = (f'@article{{X,\n  title={{{w["title"]}}},\n{j}'
                   f'  year={{{w.get("year") or "2014"}}},\n  author={{Tavora, Fabio}}\n}}')
        key = f"{first_author_last(bib)}{w.get('year') or 'na'}{first_word(w['title'])}"
        k, n = key, 1
        while k in used_keys: n += 1; k = f"{key}{n}"
        used_keys.add(k)
        bib = re.sub(r"^@(\w+)\{[^,]*,", lambda m: f"@{m.group(1)}{{{k},", bib, count=1)
        added.append(bib.strip())
        ex_titles.append(tt)
        if doi: ex_dois.add(doi.lower())

    if not added:
        print("No new publications.", file=sys.stderr); return
    marker = "\n\n\n% ===== Auto-added from ORCID + Crossref =====\n\n"
    if "Auto-added from ORCID" in existing_text:
        out = existing_text.rstrip() + "\n\n" + "\n\n".join(added) + "\n"
    else:
        out = existing_text.rstrip() + marker + "\n\n".join(added) + "\n"
    open(BIB, "w").write(out)
    print(f"Added {len(added)} new publications.", file=sys.stderr)

if __name__ == "__main__":
    main()
