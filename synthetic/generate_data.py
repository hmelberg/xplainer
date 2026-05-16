import os
import numpy as np
import pandas as pd

# ============================================================
# helpers
# ============================================================
def _clamp01(x):
    return np.minimum(1, np.maximum(0, x))

def _logit_inv(x):
    return 1 / (1 + np.exp(-x))

def _select_vars(df, variabler):
    if variabler is None:
        return df
    variabler = list(map(str, variabler))
    missing = [v for v in variabler if v not in df.columns]
    if missing:
        raise ValueError(f"Ukjente variabler i 'variabler': {', '.join(missing)}")
    return df.loc[:, variabler].copy()

def _sample_dates(rng, start_date, end_date, n):
    start = np.datetime64(start_date)
    end = np.datetime64(end_date)
    days = (end - start).astype("timedelta64[D]").astype(int)
    return (start + rng.integers(0, days + 1, size=n).astype("timedelta64[D]")).astype("datetime64[D]")

def _time_hhmm(rng, n, hour_range=(0, 23), minute_choices=None):
    if minute_choices is None:
        minute_choices = np.array([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
    hours = rng.integers(hour_range[0], hour_range[1] + 1, size=n)
    mins = rng.choice(minute_choices, size=n)
    hh = np.char.zfill(hours.astype(str), 2)
    mm = np.char.zfill(mins.astype(str), 2)
    return np.char.add(np.char.add(hh, ":"), mm)

def _age_from_year(date64D, birth_year):
    year = pd.to_datetime(date64D).year.astype(int)
    return np.clip(year - birth_year, 0, 110)

def _unique_id_strings(rng, n, start=1_000_000_000, width=10):
    """Unique-ish IDs without allocating huge ranges."""
    ids = start + np.arange(int(n), dtype=np.int64)
    rng.shuffle(ids)
    return np.array([f"{x:0{width}d}" for x in ids], dtype=f"U{width}")

# ============================================================
# shared population (the key to cross-register linkage)
# ============================================================
def build_population(n_people, seed=1):
    """
    Master person table. Use PERSON_ID across registers.
    """
    rng = np.random.default_rng(seed)

    PERSON_ID = np.array(
        [f"{x:08d}" for x in rng.choice(np.arange(10_000_000, 90_000_000), size=n_people, replace=False)]
    )

    KJONN = rng.choice([1, 2], size=n_people).astype(int)  # 1=mann, 2=kvinne

    years = np.arange(1925, 2011)
    w = np.exp(-((years - 1968) / 28) ** 2) + 1e-6
    w /= w.sum()
    FODSELSAAR = rng.choice(years, size=n_people, p=w).astype(int)

    KOMMUNENR = np.array([f"{x:04d}" for x in rng.integers(1000, 5700, size=n_people)], dtype="U4")

    # latent health drives disease and utilization
    SKJULT_HELSE = rng.normal(0, 1, size=n_people).astype(float)
    alder_2020 = 2020 - FODSELSAAR

    HAR_HK = rng.binomial(1, _clamp01(_logit_inv(-2.0 + 0.05*(alder_2020-55) + 0.7*SKJULT_HELSE))).astype(int)
    HAR_DIAB = rng.binomial(1, _clamp01(_logit_inv(-2.2 + 0.04*(alder_2020-50) + 0.6*SKJULT_HELSE))).astype(int)
    HAR_RESP = rng.binomial(1, _clamp01(_logit_inv(-2.2 + 0.03*(alder_2020-45) + 0.5*SKJULT_HELSE + 0.2*(KJONN==1)))).astype(int)
    HAR_PSYK = rng.binomial(1, _clamp01(_logit_inv(-2.0 + 0.01*(alder_2020-30) + 0.6*SKJULT_HELSE))).astype(int)

    return pd.DataFrame({
        "PERSON_ID": PERSON_ID,
        "KJONN": KJONN,
        "FODSELSAAR": FODSELSAAR,
        "KOMMUNENR": KOMMUNENR,
        "SKJULT_HELSE": SKJULT_HELSE,
        "HAR_HK": HAR_HK,
        "HAR_DIAB": HAR_DIAB,
        "HAR_RESP": HAR_RESP,
        "HAR_PSYK": HAR_PSYK,
    })

def sample_people_for_register(pop_df, n_rows, rng, overlap_share=0.80, extra_prefix="9"):
    """
    Returns PERSON_ID array length n_rows.
    overlap_share fraction are sampled from pop_df; rest are register-only persons.
    """
    n_rows = int(n_rows)
    n_from_pop = int(round(n_rows * overlap_share))
    ids_pop = rng.choice(pop_df["PERSON_ID"].values, size=n_from_pop, replace=True).astype("U8")

    n_extra = n_rows - n_from_pop
    if n_extra > 0:
        # Create register-only IDs that won't collide with 8-digit numeric PERSON_ID
        # (prefix + 7 digits)
        extra = np.array([f"{extra_prefix}{rng.integers(0, 10**7):07d}" for _ in range(n_extra)], dtype="U8")
        ids = np.concatenate([ids_pop, extra])
    else:
        ids = ids_pop

    rng.shuffle(ids)
    return ids

def get_person_attributes(ids, pop_df, rng):
    """
    For ids present in pop_df: use their attributes.
    For register-only ids: generate plausible ones.
    """
    ids = ids.astype("U8")
    pop = pop_df.set_index("PERSON_ID")

    in_pop = np.isin(ids, pop.index.values)
    out = {}

    # defaults for missing
    n = len(ids)
    KJONN = np.empty(n, dtype=int)
    FODSELSAAR = np.empty(n, dtype=int)
    KOMMUNENR = np.empty(n, dtype="U4")
    SKJULT_HELSE = np.empty(n, dtype=float)
    HAR_HK = np.empty(n, dtype=int)
    HAR_DIAB = np.empty(n, dtype=int)
    HAR_RESP = np.empty(n, dtype=int)
    HAR_PSYK = np.empty(n, dtype=int)

    # fill from pop
    if in_pop.any():
        sub = pop.loc[ids[in_pop]]
        KJONN[in_pop] = sub["KJONN"].to_numpy()
        FODSELSAAR[in_pop] = sub["FODSELSAAR"].to_numpy()
        KOMMUNENR[in_pop] = sub["KOMMUNENR"].to_numpy()
        SKJULT_HELSE[in_pop] = sub["SKJULT_HELSE"].to_numpy()
        HAR_HK[in_pop] = sub["HAR_HK"].to_numpy()
        HAR_DIAB[in_pop] = sub["HAR_DIAB"].to_numpy()
        HAR_RESP[in_pop] = sub["HAR_RESP"].to_numpy()
        HAR_PSYK[in_pop] = sub["HAR_PSYK"].to_numpy()

    # generate for out-of-pop
    if (~in_pop).any():
        m = (~in_pop).sum()
        KJONN[~in_pop] = rng.choice([1, 2], size=m).astype(int)

        years = np.arange(1925, 2011)
        w = np.exp(-((years - 1968) / 28) ** 2) + 1e-6
        w /= w.sum()
        FODSELSAAR[~in_pop] = rng.choice(years, size=m, p=w).astype(int)

        KOMMUNENR[~in_pop] = np.array([f"{x:04d}" for x in rng.integers(1000, 5700, size=m)], dtype="U4")

        SKJULT_HELSE[~in_pop] = rng.normal(0, 1, size=m).astype(float)
        alder_2020 = 2020 - FODSELSAAR[~in_pop]

        HAR_HK[~in_pop] = rng.binomial(1, _clamp01(_logit_inv(-2.0 + 0.05*(alder_2020-55) + 0.7*SKJULT_HELSE[~in_pop]))).astype(int)
        HAR_DIAB[~in_pop] = rng.binomial(1, _clamp01(_logit_inv(-2.2 + 0.04*(alder_2020-50) + 0.6*SKJULT_HELSE[~in_pop]))).astype(int)
        HAR_RESP[~in_pop] = rng.binomial(1, _clamp01(_logit_inv(-2.2 + 0.03*(alder_2020-45) + 0.5*SKJULT_HELSE[~in_pop] + 0.2*(KJONN[~in_pop]==1)))).astype(int)
        HAR_PSYK[~in_pop] = rng.binomial(1, _clamp01(_logit_inv(-2.0 + 0.01*(alder_2020-30) + 0.6*SKJULT_HELSE[~in_pop]))).astype(int)

    out["KJONN"] = KJONN
    out["FODSELSAAR"] = FODSELSAAR
    out["KOMMUNENR"] = KOMMUNENR
    out["SKJULT_HELSE"] = SKJULT_HELSE
    out["HAR_HK"] = HAR_HK
    out["HAR_DIAB"] = HAR_DIAB
    out["HAR_RESP"] = HAR_RESP
    out["HAR_PSYK"] = HAR_PSYK
    return out

# ============================================================
# derive disease flags from NPR to feed into other registers
# ============================================================
def derive_npr_person_flags(npr_df):
    """
    Person-level flags from ICD-10 main diagnosis.
    Uses first letter as coarse group.
    """
    tmp = npr_df[["NPRID", "HOVEDTILSTAND1"]].copy()
    tmp["PERSON_ID"] = tmp["NPRID"].astype(str)
    icd = tmp["HOVEDTILSTAND1"].fillna("").astype(str)
    first = icd.str[:1]

    flags = pd.DataFrame({
        "PERSON_ID": tmp["PERSON_ID"],
        "NPR_I": (first == "I").astype(int),  # circulatory
        "NPR_J": (first == "J").astype(int),  # respiratory
        "NPR_E": (first == "E").astype(int),  # endocrine/diabetes
        "NPR_F": (first == "F").astype(int),  # mental
        "NPR_C": (first == "C").astype(int),  # cancer
        "NPR_M": (first == "M").astype(int),  # musculoskeletal
        "NPR_K": (first == "K").astype(int),  # GI
    })

    out = flags.groupby("PERSON_ID", as_index=False).sum()
    out["NPR_BURDEN"] = out.drop(columns=["PERSON_ID"]).sum(axis=1)
    return out

# ============================================================
# NPR synthetic (episodes)
# ============================================================
def synth_npr(ant_obs=10000,
              start_dato="2018-01-01",
              slutt_dato="2023-12-31",
              seed=1,
              pop_df=None,
              overlap_share=0.80,
              variabler=None):
    rng = np.random.default_rng(seed)
    if pop_df is None:
        pop_df = build_population(max(2000, ant_obs // 5), seed=seed)

    PERSON_ID = sample_people_for_register(pop_df, ant_obs, rng, overlap_share=overlap_share, extra_prefix="9")
    attr = get_person_attributes(PERSON_ID, pop_df, rng)

    INNDATO = _sample_dates(rng, start_dato, slutt_dato, ant_obs)
    INNTID = _time_hhmm(rng, ant_obs, hour_range=(0, 23))
    ALDER = _age_from_year(INNDATO, attr["FODSELSAAR"]).astype(int)

    # Care level (simple)
    p_innlegg = _clamp01(_logit_inv(-0.8 + 0.03*(ALDER-60) + 0.7*attr["SKJULT_HELSE"] + 0.6*attr["HAR_HK"] + 0.4*attr["HAR_RESP"]))
    u = rng.random(ant_obs)
    OMSORGSNIVA = np.where(u < p_innlegg, "1",
                    np.where(rng.random(ant_obs) < 0.18, "2",
                      np.where(rng.random(ant_obs) < 0.03, "8", "3")))

    NIVA = np.where(OMSORGSNIVA == "1",
                    rng.choice(["A","B","C"], size=ant_obs, p=[0.30,0.50,0.20]),
                    rng.choice(["P","D"], size=ant_obs, p=[0.85,0.15]))

    # Length of stay
    los_mean = np.where(OMSORGSNIVA == "1",
                        2.2 + 0.05*np.maximum(0, ALDER-65) + 1.0*attr["SKJULT_HELSE"] + 0.9*attr["HAR_HK"] + 0.7*attr["HAR_RESP"],
                        0.1)
    LOS = np.where(OMSORGSNIVA == "1",
                   np.maximum(0, np.round(rng.lognormal(mean=np.log(np.maximum(1, los_mean)), sigma=0.45)).astype(int)),
                   0)
    UTDATO = (pd.to_datetime(INNDATO) + pd.to_timedelta(LOS, unit="D")).values.astype("datetime64[D]")
    UTTID = np.where(OMSORGSNIVA == "1", _time_hhmm(rng, ant_obs), INNTID)

    # ICD-10 pools (coarse)
    icd_pool = {
        "I": ["I10","I20","I21","I25","I48","I50"],
        "J": ["J18","J44","J45","J96"],
        "E": ["E10","E11","E78"],
        "F": ["F32","F33","F41","F10"],
        "C": ["C34","C50","C61","C18"],
        "M": ["M16","M17","M54","M81"],
        "K": ["K35","K50","K52","K80"],
        "A": ["A41","B34","N39"],
        "S": ["S72","S06","S52","T81"],
        "G": ["I63","G40","G35","G20"],
    }
    letters = list(icd_pool.keys())

    # softmax scoring for letter group (driven by chronic flags)
    scores = np.zeros((len(letters), ant_obs), dtype=float)
    for li, L in enumerate(letters):
        s = np.zeros(ant_obs, dtype=float)
        if L == "I": s += 0.06*(ALDER-55) + 1.2*attr["HAR_HK"]
        if L == "E": s += 0.04*(ALDER-45) + 1.2*attr["HAR_DIAB"]
        if L == "J": s += 0.03*(ALDER-50) + 1.1*attr["HAR_RESP"]
        if L == "F": s += 0.01*(50 - np.abs(ALDER-35)) + 1.0*attr["HAR_PSYK"]
        if L == "C": s += 0.04*(ALDER-55)
        if L == "M": s += 0.03*(ALDER-55)
        if L == "K": s += 0.01*(45 - np.abs(ALDER-30))
        if L == "A": s += 0.25 + 0.25*np.maximum(0, attr["SKJULT_HELSE"])
        if L == "S": s += 0.10 + 0.02*np.maximum(0, ALDER-70)
        if L == "G": s += 0.03*(ALDER-60)
        s += np.where(OMSORGSNIVA == "1", 0.25, 0.0)
        scores[li] = s

    # choose letter per row
    KAT = np.empty(ant_obs, dtype="U1")
    for i in range(ant_obs):
        v = scores[:, i]
        ex = np.exp(v - v.max())
        p = ex / ex.sum()
        KAT[i] = rng.choice(letters, p=p)

    # sample ICD10 with occasional decimals
    base = np.array([rng.choice(icd_pool[L]) for L in KAT], dtype="U10")
    add_dec = rng.random(ant_obs) < 0.35
    dec = rng.integers(0, 10, size=ant_obs).astype(str)
    base[add_dec] = np.char.add(np.char.add(base[add_dec], "."), dec[add_dec])
    HOVEDTILSTAND1 = base

    # secondary dx sometimes
    HOVEDTILSTAND2 = np.array([""]*ant_obs, dtype="U10")
    p2 = _clamp01(0.12 + 0.25*(OMSORGSNIVA=="1") + 0.003*np.maximum(0, ALDER-60) + 0.10*(attr["SKJULT_HELSE"]>0))
    has2 = rng.random(ant_obs) < p2
    if has2.any():
        L2 = rng.choice(letters, size=has2.sum(), replace=True)
        HOVEDTILSTAND2[has2] = np.array([rng.choice(icd_pool[L]) for L in L2], dtype="U10")

    # procedures (rare, more for inpatient and certain letters)
    pros_pool = {
        "I": ["FNA00","FNB10","FNG02","FNT30","FNW99"],
        "J": ["GAA10","GAB20","GAX99","GDB10"],
        "E": ["WJH00","WJH10","WJH99"],
        "C": ["KKA20","KKB10","KKW99","JLC10"],
        "M": ["NFB20","NGB30","NGA20","NMC00","NOM10"],
        "K": ["JEA00","JEB10","JFA20","JFW99"],
        "S": ["NCE20","NCC10","QDB10","QDW99"],
        "F": ["ZXC00","ZXC10","ZXY99"],
        "A": ["TJA00","TJB10","TJC20"],
        "G": ["AAF00","AAG10","AAW99"],
    }
    PROSEDYRE1 = np.array([""]*ant_obs, dtype="U10")
    PROSEDYRE2 = np.array([""]*ant_obs, dtype="U10")
    p_proc = _clamp01(
        0.02 + 0.35*(OMSORGSNIVA=="1") + 0.08*(OMSORGSNIVA=="2") + 0.002*np.maximum(0, ALDER-60)
        + 0.12*np.isin(KAT, ["S","K","M","C","I"])
    )
    hasp = rng.random(ant_obs) < p_proc
    for i in np.where(hasp)[0]:
        L = KAT[i]
        PROSEDYRE1[i] = rng.choice(pros_pool[L])
        if rng.random() < _clamp01(0.10 + 0.20*(OMSORGSNIVA[i]=="1") + 0.06*(L in ["C","S","K"])):
            PROSEDYRE2[i] = rng.choice(pros_pool[L])

    # DRG + weight
    DRG = np.zeros(ant_obs, dtype=int)
    DRGVEKT = np.zeros(ant_obs, dtype=float)
    base_map = {"I":10,"J":20,"E":30,"M":40,"A":50,"K":60,"G":70,"F":80,"S":90,"C":110}
    for i in range(ant_obs):
        inpatient = OMSORGSNIVA[i] == "1"
        proc = PROSEDYRE1[i] != ""
        if OMSORGSNIVA[i] in ["3","8"]:
            base_w, drg_base = rng.uniform(0.05, 0.35), 800
        elif OMSORGSNIVA[i] == "2":
            base_w, drg_base = rng.uniform(0.20, 0.90), 700
        else:
            base_w, drg_base = (rng.uniform(2.0, 6.0), 300) if proc else (rng.uniform(0.9, 2.8), 100)

        adj = 0.02*max(0, ALDER[i]-70) + 0.35*max(0.0, attr["SKJULT_HELSE"][i])
        if KAT[i] == "C": adj += rng.uniform(0.8, 2.5)
        if KAT[i] == "S": adj += rng.uniform(0.5, 2.0)
        if KAT[i] == "G": adj += rng.uniform(0.2, 1.2)
        if KAT[i] == "A": adj += rng.uniform(0.1, 0.8)
        if KAT[i] == "I" and proc: adj += rng.uniform(0.5, 1.8)

        w = max(0.02, base_w + adj + rng.normal(0, 0.15))
        DRGVEKT[i] = w
        DRG[i] = int(drg_base + base_map.get(KAT[i], 0) + rng.integers(0, 10))

    AGGRSHOPPID = _unique_id_strings(rng, ant_obs, start=1_000_000_000, width=10)

    kommune_num = attr["KOMMUNENR"].astype(int)
    REGION = np.where(
        kommune_num < 2000, "HSOR_OST",
        np.where(kommune_num < 3000, "HVEST",
                 np.where(kommune_num < 4000, "HMIDT", "HNORD"))
    )

    hospital_pool = {
        "HSOR_OST": np.array(["OUS", "AHUS", "SI", "SIV"], dtype="U8"),
        "HVEST": np.array(["HUS", "SUS", "FON", "HMR"], dtype="U8"),
        "HMIDT": np.array(["STO", "HNT", "HMN", "HMRM"], dtype="U8"),
        "HNORD": np.array(["UNN", "NLSH", "FINN", "HELG"], dtype="U8"),
    }
    SYKEHUS_ID = np.empty(ant_obs, dtype="U8")
    for reg, pool in hospital_pool.items():
        m = REGION == reg
        if m.any():
            SYKEHUS_ID[m] = rng.choice(pool, size=m.sum(), replace=True)

    df = pd.DataFrame({
        # make NPRID equal PERSON_ID (key linkage)
        "NPRID": PERSON_ID,
        "AGGRSHOPPID": AGGRSHOPPID,
        "KJONN": attr["KJONN"],
        "FODSELSAAR": attr["FODSELSAAR"],
        "INNDATO": pd.to_datetime(INNDATO),
        "INNTID": INNTID,
        "UTDATO": pd.to_datetime(UTDATO),
        "UTTID": UTTID,
        "NIVA": NIVA,
        "OMSORGSNIVA": OMSORGSNIVA,
        "HOVEDTILSTAND1": HOVEDTILSTAND1,
        "HOVEDTILSTAND2": HOVEDTILSTAND2,
        "PROSEDYRE1": PROSEDYRE1,
        "PROSEDYRE2": PROSEDYRE2,
        "DRG": DRG,
        "DRGVEKT": DRGVEKT,
        "REGION": REGION,
        "SYKEHUS_ID": SYKEHUS_ID,
        "KOMMUNENR": attr["KOMMUNENR"],
    }).sort_values(["NPRID","INNDATO","INNTID"]).reset_index(drop=True)

    return _select_vars(df, variabler)

# ============================================================
# KUHR / HELFO synthetic (GP claims) with optional conditioning on NPR
# ============================================================
def synth_kuhr(ant_obs=50000,
               start_dato="2018-01-01",
               slutt_dato="2023-12-31",
               seed=1,
               pop_df=None,
               npr_df=None,
               overlap_share=0.80,
               variabler=None):
    rng = np.random.default_rng(seed)
    if pop_df is None:
        pop_df = build_population(max(5000, ant_obs // 6), seed=seed)

    PERSON_ID = sample_people_for_register(pop_df, ant_obs, rng, overlap_share=overlap_share, extra_prefix="8")
    attr = get_person_attributes(PERSON_ID, pop_df, rng)

    DATO = _sample_dates(rng, start_dato, slutt_dato, ant_obs)
    KLOKKESLETT = _time_hhmm(rng, ant_obs, hour_range=(7, 20), minute_choices=np.array([0,10,20,30,40,50]))
    ALDER = _age_from_year(DATO, attr["FODSELSAAR"]).astype(int)

    # optional NPR flags -> increases utilization + shifts diagnostic mix
    flags = None
    if npr_df is not None and len(npr_df) > 0:
        flags = derive_npr_person_flags(npr_df)
        flags = flags.set_index("PERSON_ID")

    NPR_BURDEN = np.zeros(ant_obs, dtype=float)
    NPR_I = np.zeros(ant_obs, dtype=int)
    NPR_J = np.zeros(ant_obs, dtype=int)
    NPR_E = np.zeros(ant_obs, dtype=int)
    NPR_F = np.zeros(ant_obs, dtype=int)
    NPR_M = np.zeros(ant_obs, dtype=int)

    if flags is not None:
        m = np.isin(PERSON_ID, flags.index.values)
        if m.any():
            sub = flags.loc[PERSON_ID[m]]
            NPR_BURDEN[m] = sub["NPR_BURDEN"].to_numpy()
            NPR_I[m] = (sub["NPR_I"] > 0).to_numpy().astype(int)
            NPR_J[m] = (sub["NPR_J"] > 0).to_numpy().astype(int)
            NPR_E[m] = (sub["NPR_E"] > 0).to_numpy().astype(int)
            NPR_F[m] = (sub["NPR_F"] > 0).to_numpy().astype(int)
            NPR_M[m] = (sub["NPR_M"] > 0).to_numpy().astype(int)

    # contact type: more consultations for older + higher burden
    p_kons = _clamp01(_logit_inv(1.2 + 0.4*(ALDER>65) + 0.35*np.maximum(0, attr["SKJULT_HELSE"]) + 0.20*NPR_BURDEN))
    p_tel  = _clamp01(_logit_inv(-1.0 + 0.2*(ALDER<30) + 0.15*(rng.random(ant_obs)<0.5)))
    KONTAKTTYPE = np.empty(ant_obs, dtype="U4")
    for i in range(ant_obs):
        pr = np.array([p_kons[i], p_tel[i], max(0.02, 1 - p_kons[i] - p_tel[i])], dtype=float)
        pr = pr / pr.sum()
        KONTAKTTYPE[i] = rng.choice(["KONS","TEL","ANN"], p=pr)

    # ICPC pool
    icpc_pool = {
        "RESP": ["R74","R75","R78","R81","R96"],
        "MSK":  ["L02","L03","L15","L84","L86"],
        "PSYK": ["P01","P03","P76","P79"],
        "CVD":  ["K74","K75","K86","K87"],
        "GI":   ["D01","D06","D10","D11"],
        "INF":  ["A03","A04","A05","A07"],
        "DERM": ["S06","S07","S87"],
        "ENDO": ["T89","T90"],
        "URO":  ["U01","U02","U71"],
        "GYN":  ["X02","X08","X11"],
    }
    groups = list(icpc_pool.keys())

    # group scores (chronic + NPR flags)
    def group_scores(i):
        s = {g:0.0 for g in groups}
        s["CVD"]  += 0.05*(ALDER[i]-55) + 1.0*attr["HAR_HK"][i]  + 0.8*NPR_I[i]
        s["ENDO"] += 0.04*(ALDER[i]-50) + 1.1*attr["HAR_DIAB"][i]+ 0.8*NPR_E[i]
        s["RESP"] += 0.03*(ALDER[i]-50) + 1.0*attr["HAR_RESP"][i]+ 0.8*NPR_J[i]
        s["PSYK"] += 0.01*(50-abs(ALDER[i]-35)) + 1.0*attr["HAR_PSYK"][i] + 0.8*NPR_F[i]
        s["MSK"]  += 0.03*(ALDER[i]-45) + 0.4*max(0.0, attr["SKJULT_HELSE"][i]) + 0.6*NPR_M[i]
        s["INF"]  += 0.30 + 0.15*(ALDER[i] < 12) + 0.10*(ALDER[i] > 75)
        s["GI"]   += 0.01*(45-abs(ALDER[i]-30))
        s["DERM"] += 0.10
        s["URO"]  += 0.02*(ALDER[i]-55) + 0.10*(attr["KJONN"][i]==1)
        s["GYN"]  += (0.35 if attr["KJONN"][i]==2 else -2.0) + 0.02*(40-abs(ALDER[i]-28))
        if KONTAKTTYPE[i] == "TEL":
            s["INF"] += 0.15; s["PSYK"] += 0.10; s["MSK"] += 0.10
        return s

    # history effect (repeat same group per person)
    ord_idx = np.lexsort((KLOKKESLETT, DATO, PERSON_ID))
    last_by_pid = {}
    GRUPPE = np.empty(ant_obs, dtype="U6")

    for j in ord_idx:
        pid = PERSON_ID[j]
        last = last_by_pid.get(pid, "")
        s = group_scores(j)
        if last:
            s[last] += 1.1
        keys = np.array(groups)
        vals = np.array([s[g] for g in keys], dtype=float)
        ex = np.exp(vals - vals.max())
        pr = ex / ex.sum()
        g = rng.choice(keys, p=pr)
        GRUPPE[j] = g
        last_by_pid[pid] = g

    DIAGNOSE1 = np.array([rng.choice(icpc_pool[g]) for g in GRUPPE], dtype="U4")

    # secondary diagnosis
    DIAGNOSE2 = np.array([""]*ant_obs, dtype="U4")
    p2 = _clamp01(0.08 + 0.10*(KONTAKTTYPE=="KONS") + 0.003*np.maximum(0, ALDER-60) + 0.08*(attr["SKJULT_HELSE"] > 0) + 0.04*NPR_BURDEN)
    has2 = rng.random(ant_obs) < p2
    if has2.any():
        g2 = rng.choice(np.array(["MSK","INF","CVD","PSYK","ENDO"]), size=has2.sum(), replace=True)
        DIAGNOSE2[has2] = np.array([rng.choice(icpc_pool[x]) for x in g2], dtype="U4")

    # takster
    takst_pool = {
        "KONS": ["2ad","2ak","2ae","2af"],
        "LAB":  ["701a","701b","705a","707"],
        "PROC": ["100","105","110","150"],
        "TEL":  ["1bd","1bk"],
        "ATT":  ["L1","L2","L3"],
    }

    TAKST1 = np.array([""]*ant_obs, dtype="U6")
    TAKST2 = np.array([""]*ant_obs, dtype="U6")
    TAKST3 = np.array([""]*ant_obs, dtype="U6")

    for i in range(ant_obs):
        t1g = "TEL" if KONTAKTTYPE[i] == "TEL" else "KONS"
        TAKST1[i] = rng.choice(takst_pool[t1g])

        kompl = (0.10 +
                 0.15*(ALDER[i] > 70) +
                 0.15*(attr["SKJULT_HELSE"][i] > 0) +
                 0.10*(GRUPPE[i] in ["CVD","ENDO","RESP","PSYK"]) +
                 0.08*(NPR_BURDEN[i] > 0) +
                 0.10*(KONTAKTTYPE[i] == "KONS"))
        if rng.random() < float(_clamp01(kompl)):
            g2 = rng.choice(["LAB","PROC","ATT"], p=[0.55,0.30,0.15])
            TAKST2[i] = rng.choice(takst_pool[g2])
            if rng.random() < 0.35:
                g3 = rng.choice(["LAB","PROC"], p=[0.70,0.30])
                TAKST3[i] = rng.choice(takst_pool[g3])

    def belop_base(t):
        if t == "": return 0.0
        if t in takst_pool["KONS"]: return rng.uniform(160, 320)
        if t in takst_pool["TEL"]:  return rng.uniform(90, 180)
        if t in takst_pool["LAB"]:  return rng.uniform(40, 140)
        if t in takst_pool["PROC"]: return rng.uniform(120, 380)
        if t in takst_pool["ATT"]:  return rng.uniform(60, 220)
        return rng.uniform(50, 150)

    BELOP = np.zeros(ant_obs, dtype=int)
    for i in range(ant_obs):
        b = belop_base(TAKST1[i]) + belop_base(TAKST2[i]) + belop_base(TAKST3[i])
        b *= (1 + 0.08*(GRUPPE[i] in ["CVD","ENDO","RESP","PSYK"]) + 0.04*NPR_BURDEN[i] + rng.normal(0, 0.05))
        BELOP[i] = int(round(max(0, b)))

    KONTAKT_ID = _unique_id_strings(rng, ant_obs, start=3_000_000_000, width=10)
    HER_ID = np.array([f"{x:09d}" for x in rng.integers(100_000_000, 900_000_000, size=ant_obs)], dtype="U9")
    ORGNR = np.array([f"{x:09d}" for x in rng.integers(800_000_000, 900_000_000, size=ant_obs)], dtype="U9")

    df = pd.DataFrame({
        "FNR_PSEUDO": PERSON_ID,             # key linkage: same PERSON_ID values
        "KONTAKT_ID": KONTAKT_ID,
        "KJONN": attr["KJONN"],
        "FODSELSAAR": attr["FODSELSAAR"],
        "ALDER": ALDER,
        "DATO": pd.to_datetime(DATO),
        "KLOKKESLETT": KLOKKESLETT,
        "KONTAKTTYPE": KONTAKTTYPE,
        "DIAGNOSE1": DIAGNOSE1,
        "DIAGNOSE2": DIAGNOSE2,
        "TAKST1": TAKST1,
        "TAKST2": TAKST2,
        "TAKST3": TAKST3,
        "BELOP": BELOP,
        "HER_ID": HER_ID,
        "ORGNR": ORGNR,
        "KOMMUNENR": attr["KOMMUNENR"],
    }).sort_values(["FNR_PSEUDO","DATO","KLOKKESLETT"]).reset_index(drop=True)

    return _select_vars(df, variabler)

# ============================================================
# Legemiddelregisteret synthetic (dispensings) with optional conditioning on NPR
# ============================================================
def synth_legemiddel(ant_obs=20000,
                     start_dato="2018-01-01",
                     slutt_dato="2023-12-31",
                     seed=1,
                     pop_df=None,
                     npr_df=None,
                     overlap_share=0.80,
                     variabler=None):
    rng = np.random.default_rng(seed)
    if pop_df is None:
        pop_df = build_population(max(2000, ant_obs // 8), seed=seed)

    PERSON_ID = sample_people_for_register(pop_df, ant_obs, rng, overlap_share=overlap_share, extra_prefix="7")
    attr = get_person_attributes(PERSON_ID, pop_df, rng)

    UTLEVERT_DATO = _sample_dates(rng, start_dato, slutt_dato, ant_obs)
    ALDER = _age_from_year(UTLEVERT_DATO, attr["FODSELSAAR"]).astype(int)

    # NPR flags (optional)
    flags = None
    if npr_df is not None and len(npr_df) > 0:
        flags = derive_npr_person_flags(npr_df).set_index("PERSON_ID")

    NPR_I = np.zeros(ant_obs, dtype=int)
    NPR_J = np.zeros(ant_obs, dtype=int)
    NPR_E = np.zeros(ant_obs, dtype=int)
    NPR_F = np.zeros(ant_obs, dtype=int)
    NPR_BURDEN = np.zeros(ant_obs, dtype=float)

    if flags is not None:
        m = np.isin(PERSON_ID, flags.index.values)
        if m.any():
            sub = flags.loc[PERSON_ID[m]]
            NPR_I[m] = (sub["NPR_I"] > 0).to_numpy().astype(int)
            NPR_J[m] = (sub["NPR_J"] > 0).to_numpy().astype(int)
            NPR_E[m] = (sub["NPR_E"] > 0).to_numpy().astype(int)
            NPR_F[m] = (sub["NPR_F"] > 0).to_numpy().astype(int)
            NPR_BURDEN[m] = sub["NPR_BURDEN"].to_numpy()

    # ATC pools
    atc_pool = {
        "CVD":   ["C09AA05","C09AA02","C07AB02","C10AA05","C03CA01"],
        "DIAB":  ["A10BA02","A10BB12","A10AE04","A10BK01"],
        "RESP":  ["R03AC02","R03BA02","R03DC03","R03AK06"],
        "PSYK":  ["N06AB06","N06AX11","N05BA12","N05AH03"],
        "PAIN":  ["N02BE01","N02AA05","M01AE01"],
        "ABX":   ["J01CA04","J01CR02","J01MA02","J01FA10"],
        "GI":    ["A02BC02","A02BA01","A06AD15"],
        "THYR":  ["H03AA01"],
        "ANTIT": ["B01AC06","B01AA03"],
        "CONTR": ["G03AA07","G03AC09"],
    }
    grupper = list(atc_pool.keys())
    ddd_mean = {"CVD":90, "DIAB":90, "RESP":60, "PSYK":60, "PAIN":20, "ABX":10, "GI":30, "THYR":90, "ANTIT":90, "CONTR":90}

    # choose group via softmax score per row (chronic + NPR)
    GRUPPE = np.empty(ant_obs, dtype="U10")
    for i in range(ant_obs):
        s = {g:0.0 for g in grupper}
        s["CVD"]   += 0.06*(ALDER[i]-55) + 1.2*attr["HAR_HK"][i]   + 1.0*NPR_I[i]
        s["DIAB"]  += 0.05*(ALDER[i]-50) + 1.2*attr["HAR_DIAB"][i] + 1.0*NPR_E[i]
        s["RESP"]  += 0.03*(ALDER[i]-45) + 1.0*attr["HAR_RESP"][i] + 1.0*NPR_J[i]
        s["PSYK"]  += 0.01*(50-abs(ALDER[i]-35)) + 1.0*attr["HAR_PSYK"][i] + 1.0*NPR_F[i]
        s["GI"]    += 0.02*(ALDER[i]-50) + 0.3*max(0.0, attr["SKJULT_HELSE"][i])
        s["ABX"]   += 0.15 + 0.25*max(0.0, attr["SKJULT_HELSE"][i]) + 0.08*(NPR_BURDEN[i]>0)
        s["PAIN"]  += 0.02*(ALDER[i]-40) + 0.4*max(0.0, attr["SKJULT_HELSE"][i])
        s["THYR"]  += 0.02*(ALDER[i]-50)
        s["ANTIT"] += 0.03*(ALDER[i]-55) + 0.6*attr["HAR_HK"][i]
        s["CONTR"] += (0.7 if attr["KJONN"][i]==2 else -2.0) + 0.03*(35-abs(ALDER[i]-25))

        keys = np.array(grupper)
        vals = np.array([s[g] for g in keys], dtype=float)
        ex = np.exp(vals - vals.max())
        pr = ex / ex.sum()
        GRUPPE[i] = rng.choice(keys, p=pr)

    ATC = np.array([rng.choice(atc_pool[g]) for g in GRUPPE], dtype="U10")

    RESEPTTYPE = np.where(rng.random(ant_obs) < 0.92, "R",
                   np.where(rng.random(ant_obs) < 0.60, "H", "A"))

    ANTALL_PAKNINGER = np.maximum(1, rng.poisson(1.2 + 0.35*np.isin(GRUPPE, ["CVD","DIAB","THYR","ANTIT"]) + 0.10*NPR_BURDEN)).astype(int)

    meanlog = np.log(np.array([ddd_mean[g] for g in GRUPPE], dtype=float) + 5*ANTALL_PAKNINGER)
    DDD = np.maximum(1, np.round(rng.lognormal(mean=meanlog, sigma=0.35))).astype(int)

    RESEPTGRUPPE = np.where(np.isin(GRUPPE, ["CVD","DIAB","THYR","ANTIT","RESP","PSYK"]), "B", "A")
    REFUSJON = np.where(RESEPTGRUPPE=="B", 1, rng.binomial(1, 0.25)).astype(int)

    base_price = np.where(np.isin(GRUPPE, ["DIAB","PSYK","ANTIT"]), 400,
                   np.where(np.isin(GRUPPE, ["CVD","RESP","GI"]), 250,
                     np.where(np.isin(GRUPPE, ["ABX","PAIN"]), 180, 220)))
    PRIS = np.round(np.maximum(0, rng.lognormal(mean=np.log(base_price) + 0.002*DDD, sigma=0.35))).astype(int)

    APOTEK_ID = np.array([f"{x:05d}" for x in rng.integers(1, 100_000, size=ant_obs)], dtype="U5")
    VARENR = np.array([f"{x:06d}" for x in rng.integers(1, 1_000_000, size=ant_obs)], dtype="U6")
    EKSPEDISJON_ID = _unique_id_strings(rng, ant_obs, start=2_000_000_000, width=10)

    df = pd.DataFrame({
        "PERSON_ID": PERSON_ID,
        "EKSPEDISJON_ID": EKSPEDISJON_ID,
        "KJONN": attr["KJONN"],
        "FODSELSAAR": attr["FODSELSAAR"],
        "ALDER": ALDER,
        "UTLEVERT_DATO": pd.to_datetime(UTLEVERT_DATO),
        "ATC": ATC,
        "VARENR": VARENR,
        "ANTALL_PAKNINGER": ANTALL_PAKNINGER,
        "DDD": DDD,
        "PRIS": PRIS,
        "RESEPTTYPE": RESEPTTYPE,
        "RESEPTGRUPPE": RESEPTGRUPPE,
        "REFUSJON": REFUSJON,
        "APOTEK_ID": APOTEK_ID,
        "KOMMUNE_NR": attr["KOMMUNENR"],
    }).sort_values(["PERSON_ID","UTLEVERT_DATO"]).reset_index(drop=True)

    return _select_vars(df, variabler)

# ============================================================
# SSB synthetic (socio-demographic rows; cross-section-ish)
# ============================================================
def synth_ssb_individ(ant_obs=50000,
                      start_aar=2018,
                      slutt_aar=2023,
                      seed=1,
                      pop_df=None,
                      overlap_share=0.85,
                      variabler=None):
    rng = np.random.default_rng(seed)
    if pop_df is None:
        pop_df = build_population(max(3000, ant_obs // 4), seed=seed)

    aar = np.arange(int(start_aar), int(slutt_aar) + 1)
    AAR = rng.choice(aar, size=int(ant_obs), replace=True).astype(int)

    PERSON_ID = sample_people_for_register(pop_df, ant_obs, rng, overlap_share=overlap_share, extra_prefix="6")
    attr = get_person_attributes(PERSON_ID, pop_df, rng)

    ALDER = np.clip(AAR - attr["FODSELSAAR"], 0, 105).astype(int)

    # crude education correlated with cohort + latent health (and chronic burden)
    base_utd = (-0.2 + 0.012*(attr["FODSELSAAR"] - 1965) + 0.20*attr["SKJULT_HELSE"])
    p_lang = _clamp01(_logit_inv(base_utd - 0.7))
    p_kort = _clamp01(_logit_inv(base_utd - 0.2)) - p_lang
    p_vgs  = _clamp01(_logit_inv(base_utd + 0.4)) - p_kort - p_lang
    p_gr   = np.maximum(0.02, 1 - (p_vgs + p_kort + p_lang))
    s = p_gr + p_vgs + p_kort + p_lang
    p_gr, p_vgs, p_kort, p_lang = p_gr/s, p_vgs/s, p_kort/s, p_lang/s

    UTD_NIVAA = np.array([
        rng.choice([1,2,3,4], p=[p_gr[i], p_vgs[i], p_kort[i], p_lang[i]])
        for i in range(ant_obs)
    ], dtype=int)

    # employment / income
    chronic = attr["HAR_HK"] + attr["HAR_DIAB"] + attr["HAR_RESP"] + attr["HAR_PSYK"]
    p_syss = _clamp01(_logit_inv(
        1.2 + 0.45*(UTD_NIVAA - 2) + 0.45*attr["SKJULT_HELSE"] - 0.10*chronic
        + 0.015*(ALDER - 30) - 0.0005*(ALDER - 45)**2
    ))
    SYSSELSATT = rng.binomial(1, p_syss).astype(int)

    p_trygd = _clamp01(_logit_inv(-2.0 + 0.05*np.maximum(0, ALDER-50) - 0.25*(UTD_NIVAA-2) - 0.55*attr["SKJULT_HELSE"] + 0.20*chronic))
    TRYGD = rng.binomial(1, p_trygd).astype(int)

    base_log = (12.4 +
                0.20*(UTD_NIVAA - 2) +
                0.015*(ALDER - 35) -
                0.0003*(ALDER - 45)**2 +
                0.18*attr["SKJULT_HELSE"] +
                0.08*(attr["KJONN"] == 1))
    base_log = base_log + np.where(SYSSELSATT == 1, 0.35, -0.60) + np.where(TRYGD == 1, -0.45, 0.0)
    INNTEKT = np.round(np.maximum(0, rng.lognormal(mean=base_log, sigma=0.35))).astype(int)

    NUS2000 = np.where(UTD_NIVAA == 1, 10,
                np.where(UTD_NIVAA == 2, 20,
                  np.where(UTD_NIVAA == 3, 60, 70))).astype(int)

    df = pd.DataFrame({
        "PERSON_ID": PERSON_ID,
        "AAR": AAR,
        "KJONN": attr["KJONN"],
        "FODSELSAAR": attr["FODSELSAAR"],
        "ALDER": ALDER,
        "KOMMUNENR": attr["KOMMUNENR"],
        "NUS2000": NUS2000,
        "SYSSELSATT": SYSSELSATT,
        "TRYGD": TRYGD,
        "INNTEKT": INNTEKT,
    }).sort_values(["PERSON_ID","AAR"]).reset_index(drop=True)

    return _select_vars(df, variabler)

# ============================================================
# filename logic + batch generation/saving
# ============================================================
def _n_suffix(n: int) -> str:
    n = int(n)
    if n >= 1_000_000 and n % 1_000_000 == 0:
        m = n // 1_000_000
        return "million" if m == 1 else f"{m}million"
    if n >= 1_000 and n % 1_000 == 0:
        k = n // 1_000
        return "thousand" if k == 1 else f"{k}thousand"
    return str(n)

def _fname(register: str, n: int, ext: str = "csv") -> str:
    suf = _n_suffix(n)
    sep = "" if suf.isdigit() else "_"
    return f"{register}{sep}{suf}.{ext}"

def generate_and_save_all(n: int,
                          start_date: str,
                          end_date: str,
                          out_dir: str = ".",
                          seed: int = 1,
                          population_size: int | None = None,
                          overlap_npr: float = 0.85,
                          overlap_helfo: float = 0.80,
                          overlap_lmr: float = 0.80,
                          overlap_ssb: float = 0.85):
    """
    Generates and saves:
      - npr_*.csv   (NPR episodes)
      - helfo_*.csv (KUHR/HELFO claims)
      - lmr_*.csv   (Legemiddelregister dispensings)
      - ssb_*.csv   (SSB socio-demographic rows)

    Cross-correlation:
      - NPR diagnoses -> influence HELFO visit/diagnosis mix and LMR ATC mix
      - shared PERSON_ID across registers for overlapping persons
      - non-overlap: each register also has some register-only persons
    """
    os.makedirs(out_dir, exist_ok=True)
    rng = np.random.default_rng(seed)

    if population_size is None:
        # enough people to create overlap but not huge
        population_size = max(5000, n // 3)

    pop = build_population(population_size, seed=seed)

    npr = synth_npr(
        ant_obs=n, start_dato=start_date, slutt_dato=end_date, seed=seed,
        pop_df=pop, overlap_share=overlap_npr
    )

    helfo = synth_kuhr(
        ant_obs=n, start_dato=start_date, slutt_dato=end_date, seed=seed + 1,
        pop_df=pop, npr_df=npr, overlap_share=overlap_helfo
    )

    lmr = synth_legemiddel(
        ant_obs=n, start_dato=start_date, slutt_dato=end_date, seed=seed + 2,
        pop_df=pop, npr_df=npr, overlap_share=overlap_lmr
    )

    start_year = pd.to_datetime(start_date).year
    end_year = pd.to_datetime(end_date).year
    ssb = synth_ssb_individ(
        ant_obs=n, start_aar=start_year, slutt_aar=end_year, seed=seed + 3,
        pop_df=pop, overlap_share=overlap_ssb
    )

    datasets = {"npr": npr, "helfo": helfo, "lmr": lmr, "ssb": ssb}

    paths = {}
    for reg, df in datasets.items():
        fn = _fname(reg, n, "csv")
        path = os.path.join(out_dir, fn)
        df.to_csv(path, index=False)
        paths[reg] = path

    return paths

# ============================================================
# example
# ============================================================
paths = generate_and_save_all(
     n=1000,
     start_date="2019-01-01",
     end_date="2023-12-31",
     out_dir="synthetic_register_data",
     seed=42
 )
print(paths)