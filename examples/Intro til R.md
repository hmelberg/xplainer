::: defaults
speech_lang=nb-NO

::: write_speak
# Velkommen til helseanalyse med R! 
Norge har noen av verdens beste helseregistre. Men for å låse opp innsikten som ligger i disse dataene, trenger vi de rette verktøyene. R er "gullstandarden" for statistikere og forskere som jobber med registerdata.
::: title
Hva er registerdata

::: write_speak
Data fra kilder som Norsk pasientregister (NPR) består ofte av rader med sykehusinnleggelser. Hver rad forteller oss *hvem* som var inne, *når* de kom, og *hvorfor* de var der (diagnosekoder).
::: write_speak
La oss starte med å lage et lite, kunstig datasett som ligner på det vi møter i virkeligheten.
::: r
# Vi lager en liste med ID-er, datoer og ICD-10 koder
npr_data <- data.frame(
  pasient_id = c(101, 102, 103, 101, 104, 105), # Unike ID-er for pasienter
  alder = c(45, 67, 12, 45, 82, 34), # Alder ved innleggelse
  inn_dato = as.Date(c("2023-01-05", "2023-01-10", "2023-01-15", "2023-02-01", "2023-02-10", "2023-02-12")), # Innleggelsesdato
  diagnose = c("I21.0", "J44.1", "S72.0", "I21.0", "E11.9", "J44.1"), # ICD-10 koder for hjerteinfarkt, kols, lårhalsbrudd osv.
  liggetid = c(3, 7, 2, 4, 12, 5) # Antall dager på sykehus
)
print(npr_data) # Her ser vi hvordan tabellen ser ut
::: write_speak
Nå som vi har dataene våre i objektet `npr_data`, kan vi begynne å utforske dem. Legg merke til hvordan vi bruker pilen `<-` for å lagre informasjon i et navn vi velger selv.
::: title=Velge variabler og beregne snitt
::: write_speak
For å snakke med en spesifikk kolonne i datasettet, bruker vi tegnet `$`. Tenk på det som en peker: `datasett$kolonne`.
::: write_speak
La oss finne ut hva den gjennomsnittlige liggetiden er for disse pasientene.
::: r(title=Beregne gjennomsnitt)
liggetider <- npr_data$liggetid # Her henter vi ut kun kolonnen for liggetid
snitt_liggetid <- mean(liggetider) # Vi regner ut gjennomsnittet og lagrer det i 'snitt_liggetid'
snitt_liggetid # Vi printer resultatet til skjermen
::: write_speak
Vi ser at gjennomsnittlig liggetid er `r mean(c(3, 7, 2, 4, 12, 5))` dager. Dette er en enkel, men kraftfull måte å oppsummere store mengder data på.
::: title="Visualisering av alder"
::: write_speak
Bilder sier mer enn tusen rader. I R er det veldig lett å lage en kjapp oversikt over fordelingen av for eksempel alder i datasettet vårt.
::: r(title=Histogram over alder, auto_run=block)
hist(npr_data$alder, 
     col = "skyblue", # Vi setter fargen til himmelblå
     main = "Aldersfordeling i utvalget", # Dette er hovedtittelen på plottet
     xlab = "Alder (år)", # Navn på x-aksen
     ylab = "Antall pasienter") # Navn på y-aksen
::: draw(title=Hva ser vi i plottet?)

::: multiple_choice
Hvilket tegn bruker vi i R for å velge en spesifikk variabel (kolonne) fra et datasett?
* `$`
- `<-`
- `%`
- `&`
::: write_speak
### Oppsummering
Du har nå sett hvordan vi:
1. Lager et datasett med `data.frame()`.
2. Bruker `<-` for å lagre data i variabler.
3. Bruker `$` for å velge kolonner.
4. Bruker funksjoner som `mean()` og `hist()` for å analysere dataene.

Dette er grunnmuren i all helseanalyse i R!
::: write_speak
### Veien videre
Hvis du vil lære mer om hvordan man håndterer store helsedata effektivt, anbefaler jeg disse ressursene:
::: xplainer_link
https://r4ds.hadley.nz/
R for Data Science (Bok)
::: youtube(src="https://www.youtube.com/watch?v=ANMuuq502rE", title="Introduksjon til Tidyverse i R")
::: write
Du kan også sjekke ut [Folkehelseinstituttets opplæringsmateriell](https://www.fhi.no) for mer kontekst om norske helsedata.
:::