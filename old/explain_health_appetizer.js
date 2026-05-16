window.lecture = [
  {
    "type": "defaults",
    "font_size_px": 24,
    "draw_coords": "cartesian",
    "layout_split": 100,
    "speech_lang": "nb-NO",
    "execution_mode": "movie",
    "movie_wait_seconds": 4
  },
  {
    "type": "new_page",
    "title": "Helseanalyse i R – korte eksempler"
  },
  {
    "type": "write_speak",
    "markdown": "La oss starte med å gi noen raske smakebiter på hvordan man kan bruke R for å analysere helsedata.",
    "location": "left"
  },
  {
    "type": "write_speak",
    "markdown": "### Lekedatasett – simulerte innleggelser\nVi lager et lite datasett nå. Koden under lager 1000 rader med pasient‑ID, dato, kostnad og diagnosekode. Poenget er å få noe som **ligner** ekte helsedata, slik at vi kan analysere det.",
    "location": "left"
  },
  {
    "type": "webr",
    "result_location": "inside",
    "code": "# Lag et syntetisk datasett\n\nset.seed(123)\nn_rows <- 1000\n\n# Lag data frame\n\nclaims <- data.frame(\nclaim_id = 1:n_rows,\npatient_id = sample(1:700, n_rows, replace = TRUE), # Noen pasienter kommer igjen\nadmission_date = as.Date('2023-01-01') + sample(0:365, n_rows, replace = TRUE),\ncost = rgamma(n_rows, shape = 2, scale = 2000), # Skjev kostnadsfordeling\ndrg_code = sample(c(\"101\", \"102\", \"882\", \"470\"), n_rows, replace = TRUE)\n)\n\n# Vis de første radene\n\nhead(claims)"
  },
  {
    "type": "highlight",
    "code_text": "set.seed(123)",
    "location": -1,
    "style": "background",
    "color": "rgba(250, 204, 21, 0.45)",
    "speak": "Legg merke til at vi setter frøet med set dot seed, slik at resultatene blir reproduserbare."
  },
  {
    "type": "write_speak",
    "markdown": "Her bruker vi `rgamma` for å få en skjev kostnadsfordeling (mange moderate, få veldig dyre). `head(claims)` viser de første radene, slik at vi kan sjekke at dataene ser riktige ut.",
    "location": "left"
  },
  {
    "type": "write_speak",
    "markdown": "## Fordelingen av kostnader\nI helsedata er kostnader sjelden normalfordelt. De fleste opphold koster moderat, men noen få er veldig dyre. Dette er akkurat det vi vil se i fordelingen.",
    "location": "left"
  },
  {
    "type": "write_speak",
    "markdown": "Hvis vi tegner histogrammet, forventer vi en **lang hale** mot høyre – få, men svært dyre opphold."
  },
  {
    "type": "wait",
    "click": true
  },
  {
    "type": "write_speak",
    "markdown": "### Oppsummering med `summary` og histogram\nVi bruker `summary(claims$cost)` for å se min, median og kvartiler. Deretter tegner vi et histogram for å se formen på fordelingen.",
    "location": "left"
  },
  {
    "type": "webr",
    "code": "# Oppsummering av kostnadskolonnen\n\nsummary(claims$cost)\n\n# Rask visualisering med base R\n\nhist(claims$cost,\ncol = \"lightblue\",\nbreaks = 20)"
  },
  {
    "type": "write_speak",
    "markdown": "## Besøksfrekvens\nEt sentralt spørsmål er: **Hvor mange har ett, to, tre eller flere besøk på sykehuset?**",
    "location": "left"
  },
  {
    "type": "write_speak",
    "markdown": "Hvis pasient 1 kommer **tre ganger**, og pasient 2 kommer **én gang** ...",
    "location": "left"
  },
  {
    "type": "write_speak",
    "markdown": "...må vi **gruppere på `patient_id`** for å telle antall besøk. I `dplyr` kan vi bruke `count`, som er en kortvei til `group_by` + `summarise`.",
    "location": "left"
  },
  {
    "type": "webr",
    "code": "library(dplyr)\n\n# 1. Tell antall besøk per pasient\n\npatient_counts <- claims %>%\ncount(patient_id, name = \"visit_count\")\n\n# 2. Hvor mange pasienter har 1 besøk, 2 besøk, osv.\n\nvisit_distribution <- patient_counts %>%\ncount(visit_count) %>%\nmutate(percent = n / sum(n) * 100)\n\nprint(visit_distribution)"
  },
  {
    "type": "write_speak",
    "markdown": "## 80/20‑regelen\nI helsetjenester ser vi ofte at en liten andel pasienter står for en stor andel av kostnadene. Dette kalles **Pareto‑prinsippet**.",
    "location": "left"
  },
  {
    "type": "wait",
    "click": true
  },
  {
    "type": "write_speak",
    "markdown": "### Beregn konsentrasjonen\nVi finner hvor stor andel av kostnadene de **20 % dyreste** pasientene står for. Koden summerer kostnad per pasient, sorterer og beregner andel.",
    "location": "left"
  },
  {
    "type": "webr",
    "code": "# 1. Summer total kostnad per pasient\n\npatient_costs <- claims %>%\ngroup_by(patient_id) %>%\nsummarise(total_cost = sum(cost)) %>%\narrange(desc(total_cost)) # Sorter høyest til lavest\n\n# 2. Beregn andel for topp 20 %\n\ntotal_spend <- sum(patient_costs$total_cost)\n\ntop_20_percent_index <- floor(0.2 * nrow(patient_costs))\n\n# Kostnad for topp 20 % / Total kostnad\n\ntop_spend <- sum(patient_costs$total_cost[1:top_20_percent_index])\nshare <- top_spend / total_spend\n\npaste0(\"De 20 % dyreste pasientene står for \", round(share*100, 1), \"% av kostnadene.\")"
  },
  {
    "type": "write_speak",
    "markdown": "## Slå opp koder (kodebok)\nMedisinske data har ofte koder som «DRG 882». For å gjøre dem forståelige trenger vi en **kodebok** (oppslagstabell).",
    "location": "left"
  },
  {
    "type": "write_speak",
    "markdown": "Vi bruker en **left join** for å legge tekstbeskrivelsen inn i dataene våre.",
    "location": "left"
  },
  {
    "type": "webr",
    "code": "# 1. Lag en oppslagstabell (kodebok)\n\ndrg_codes <- data.frame(\ndrg_code = c(\"101\", \"102\", \"882\", \"470\"),\ndescription = c(\"Hjertetransplantasjon\", \"Lungetransplantasjon\", \"Nevroser\", \"Uklassifiserbar\")\n)\n\n# 2. Knyt kodebok til data\n\nclaims_enriched <- claims %>%\nleft_join(drg_codes, by = \"drg_code\")\n\n# 3. Sjekk resultatet\n\nclaims_enriched %>%\nselect(patient_id, cost, drg_code, description) %>%\nhead()"
  },
  {
    "type": "write_speak",
    "markdown": "### Oppsummering\nVi har laget data, undersøkt kostnadsfordeling, analysert gjentatte pasienter og koblet koder til tekst – alt i R. Dette er grunnmuren i helseanalyse.",
    "location": "left"
  }
]
