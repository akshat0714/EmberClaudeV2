# Research basis

Every behavioral parameter in this app is derived from published fire-behavior research,
WUI-evacuation research, official incident records, or verified live data sources. This file
maps **each parameter to its source**. Citations were verified against the primary documents
(USDA Forest Service research papers, NIST technical notes, NWS archives, FAA/ASOS observation
archives) — not paraphrased from memory — on 2026-06-10.

> The app remains a clearly-labelled simulation for communication and demonstration.
> It is **not** an operational fire model and **not** emergency guidance.

---

## 1. Fire spread model

### 1.1 Fire shape: length-to-breadth ratio (`FIRE_SHAPE.lengthToBreadth`)

FARSITE's single-ellipse fire shape (Finney, RMRS-RP-4, Eq. 13; modified from Anderson 1983,
INT-305, Eq. 17):

```
LB = 0.936·e^(0.2566·U) + 0.461·e^(−0.1548·U) − 0.397     (U in m/s, capped at LB = 8)
```

- `U` is the **effective midflame wind speed in m/s** — the wind–slope resultant after the
  wind-adjustment factor (see 1.3, 1.4). The −0.397 offset is Finney's, forcing LB = 1 at calm.
- LB > 8 truncated "based on the maximum of empirical data referenced by Alexander (1985)".

Sources:
- Finney, M.A. 1998 (rev. 2004). *FARSITE: Fire Area Simulator — model development and
  evaluation.* USDA Forest Service Res. Pap. RMRS-RP-4. Eq. [13]–[17].
  https://www.fs.usda.gov/rm/pubs/rmrs_rp004.pdf
- Anderson, H.E. 1983. *Predicting wind-driven wildland fire size and shape.* INT-305. Eq. (17).

### 1.2 Direction-dependent spread rate (`stepSpeed` elliptical kernel)

Rear-focus ellipse polar form, with the ignition point at the rear focus (Andrews 2018,
RMRS-GTR-371 §6.2, after Catchpole et al. 1982 / Alexander 1985):

```
ε    = √(LB² − 1) / LB
R(θ) = R_head · (1 − ε) / (1 − ε·cosθ)        θ measured from the heading direction
```

Backing rate is R_head·(1−ε)/(1+ε); flanking ≈ R_head·(1−ε).

Source: Andrews, P.L. 2018. *The Rothermel surface fire spread model and associated
developments: a comprehensive explanation.* RMRS-GTR-371, §6.2.
https://www.fs.usda.gov/rm/pubs_series/rmrs/gtr/rmrs_gtr371.pdf

### 1.3 Wind adjustment factor (`WIND.wind10mMps` → midflame)

Midflame wind = **0.4 ×** the 10-m open wind for unsheltered surface fuels (Rothermel's
original treatment; equivalently WAF ≈ 0.4–0.46 of the 20-ft wind). Source: Andrews, P.L.
2012. *Modeling wind adjustment factor and midflame wind speed for Rothermel's surface fire
spread model.* RMRS-GTR-266 (Albini & Baughman 1979; Baughman & Albini 1980).
https://www.fs.usda.gov/rm/pubs/rmrs_gtr266.pdf

### 1.4 Slope as equivalent wind (`SLOPE_WIND`)

Rothermel (1972) treats slope as an additional spread factor; GTR-371 §4.1 combines wind and
slope into one **effective wind speed**, and §5.4.3 requires **vector addition** when wind is
not aligned upslope. GTR-371 Table 24 gives the equivalence we fit:

| Slope (tan φ) | Equivalent midflame wind |
| --- | --- |
| 20% | ≈ 0.6–1.1 mi/h (~0.4 m/s) |
| 50% | ≈ 3 mi/h (~1.3 m/s) |
| 100% | ≈ 7–8 mi/h (~3.4 m/s) |

We fit `U_slope = 3.4 · tan(φ)^1.38` m/s (matches 1.3 m/s at 50% and 3.4 m/s at 100%),
pointing upslope, added vectorially to the wind vector. Slopes steeper than 100% are capped.

### 1.5 Head rate of spread (`SPEEDS`)

Rothermel's wind factor for fine fuels is superlinear: φ_w ∝ U^B with **B = 0.15988·σ^0.514 ≈
1.5** for σ ≈ 3,500 ft⁻¹ grass (GTR-371 App. A). We use that exponent with the head rate

```
R_head = R0 · fuel · dryness · (1 + k·U^1.5)       U in m/s (effective midflame)
```

calibrated so that under the Kenneth Fire's verified conditions (U ≈ 3.5–4 m/s effective,
critically dry fuels, see §3) the open-fuel head rate is ≈ 18–20 m/min — consistent with the
fire's reconstructed forward run (~1.8 km in ~86 min during the main push) and within the
documented envelope for Santa Ana chaparral fires:

- Witch Creek Fire 2007 (City of San Diego After-Action Report): "rates of spread on occasion
  in excess of 5 miles per hour" (≈134 m/min), flame lengths 80–100 ft, gusts reported over
  100 mph. https://www.sandiego.gov/sites/default/files/legacy/fire/pdf/witch_aar.pdf
- Cedar Fire 2003: ~30 mi in a few hours (≈130–200 m/min) under 60-mph winds.
- Extreme cured-grass fires: 15–20 km/h sustained documented (Cheney & Gould / CSIRO;
  fastest reliably recorded 27.3 km/h, Noble 1991).

**Known limitation (documented honestly):** calibrated to a Kenneth-scale event; it
underpredicts the extreme plume-driven/spotting-driven runs above.

### 1.6 Fuels (`FUELS`)

Fire-carrying fuel loads from the standard fuel models:

- Chaparral: Anderson (1982) FM4, total <3-in load **13.0 t/ac ≈ 2.9 kg/m²**; Scott & Burgan
  (2005) SH5 fine load **≈1.46 kg/m²**. We use w = 2.0 kg/m² available in the flaming front.
- Annual grassland: Scott & Burgan GR1–GR2 ≈ **0.09–0.25 kg/m²**; we use 0.25 (GR2).
- Sources: Anderson, H.E. 1982. *Aids to determining fuel models for estimating fire
  behavior.* INT-122. Scott, J.H. & Burgan, R.E. 2005. *Standard fire behavior fuel models.*
  RMRS-GTR-153.

The January 2025 dryness (RH 5–6% observed, see §3; preceded by months without rain) maps to
the `drynessFactor` ≥ 1 applied to R0.

### 1.7 Fireline intensity & flame length (`INTENSITY`)

Byram (1959), as stated in GTR-371 §4.4–4.5 (metric form, Wilson 1980 / GTR-371 Table A.3):

```
I  = H · w · R                  kW/m   (H kJ/kg, w kg/m², R m/s)
L  = 0.0775 · I^0.46            m
H ≈ 18,000 kJ/kg                (standard operational heat yield)
```

`w` is fuel consumed **in the flaming front**, not total biomass. The intensity legend uses
the standard fire-suppression interpretation thresholds (hauling chart / NWCG): ~350 kW/m
(hand-crew limit), ~1,700 kW/m (equipment limit), ~3,500 kW/m (control unlikely, crowning/
spotting). Source: Byram, G.M. 1959, *Combustion of forest fuels* in Davis (ed.) *Forest
Fire: Control and Use*; Andrews 2018 GTR-371.

### 1.8 Burning duration behind the front (`INTENSITY.decay`)

- Flaming-front residence time: Anderson (1969, INT-69) **t_r = 8·d** (d = particle diameter,
  inches) ⇒ t_r = 384/σ minutes (Rothermel 1983 INT-143 App. C): grass ≈ 7 s, chaparral fine
  fuels ≈ 13 s.
- Post-frontal combustion lasts far longer and scales with fuel diameter (same 8·d rule:
  1-inch stems ≈ 8 min, 3-inch ≈ 24 min; logs/duff smolder for hours). FARSITE models
  post-frontal combustion separately (Finney RMRS-RP-4; Reinhardt et al.).
- Our intensity field therefore decays exponentially behind the front with fuel-class time
  constants (grass minutes-scale, chaparral tens-of-minutes scale) — the **bright flaming
  band is thin and the burned interior cools** — matching the guidance that residence time ≠
  burnout time.

### 1.9 Ember spotting (`SPOT_FIRES`)

- Model concept: Albini, F.A. 1979. *Spot fire distance from burning trees — a predictive
  model.* INT-GTR-56 (adopted by FARSITE; RMRS-RP-4 Eqs. [34]–[35]).
- Observed Santa Ana WUI spotting: "long range spotting over half a mile" (Witch AAR, ≈800 m);
  hundreds of meters to >1 km routinely (NIST TN-1635 Witch/Guejito ember-ignition study).
- There is **no accepted deterministic spot-density law** — ignition frequency falls off with
  distance and is highly stochastic. We accordingly ignite 0–3 spot fires downwind with an
  exponential distance distribution (mean 300 m, max 800 m for this moderate-gust event),
  deterministic per timeline interval (seeded PRNG) so the visualization is stable.

### 1.10 Terrain inputs (real data)

- **Elevation:** AWS Open Data Terrain Tiles (tilezen/joerd "terrarium" encoding
  `elev = R·256 + G + B/256 − 32768`), which for this area carry **USGS NED/3DEP 1/3
  arc-second (~10 m)** source data (verified via the tile response header
  `x-amz-meta-x-imagery-sources: ned13/...`). Resampled to a 30-m grid at build time.
  License: free/open; attribution "3DEP/SRTM data courtesy of the U.S. Geological Survey".
  https://registry.opendata.aws/terrain-tiles/
- **Slope/aspect** computed from that DEM by central differences; **canyon channeling** from
  the DEM via a structure-tensor fit of the local terrain axis plus relative-depression depth
  (valley bottoms below the smoothed neighborhood mean), replacing hand-drawn canyon lines.
- **Developed areas / fuel breaks** from the real OSM street network: grid cells dense with
  street geometry are urban fabric (heavily suppressed spread — irrigation, pavement,
  defended structures); cells crossed by a single road get a partial fuel-break factor
  (roads slow surface fire but are jumped by embers — NIST TN-1635).

## 2. Evacuation routing

### 2.1 Trigger-buffer safety logic (`NAV.hardMarginMin`, `softMarginMin`)

The router enforces, point-by-point along every candidate road:

```
clearance = fire_arrival_time − evacuee_arrival_time ≥ margin
```

This is the inverted form of the wildfire **evacuation trigger** methodology — Cova et al.
set fire-travel-time buffers around communities equal to evacuation time **plus a safety
cushion**, computed with Dijkstra over a fire rate-of-spread network (exactly the
minimum-travel-time field our model produces):

- Cova, T.J., Dennison, P.E., Kim, T.H., Moritz, M.A. 2005. "Setting wildfire evacuation
  trigger points using fire spread modeling and GIS." *Transactions in GIS* 9(4):603–617.
  (Calabasas-area case study — a few km from this app's scenario — with 15/30/45-minute
  buffers.)
- Dennison, P.E., Cova, T.J., Moritz, M.A. 2007. "WUIVAC: a wildland-urban interface
  evacuation trigger model applied in strategic wildfire scenarios." *Natural Hazards*
  41:181–199. Buffer rule: expected evacuation time "**plus additional time accounting for
  possible uncertainty**" (their Julian case: 2 h evacuation + 1 h cushion = +50%).
- Li, D., Cova, T.J., Dennison, P.E. 2019. *Fire Technology* 55:617–642 (coupled
  fire + traffic simulation; higher demand ⇒ larger buffer).

Our margins follow the WUIVAC +50% cushion principle at neighborhood scale: typical in-area
drive ≤ ~20 min ⇒ **hard margin 10 min** (route rejected below this predicted clearance),
**soft margin 20 min** (allowed but cost-penalized), with a 2-min "survival" floor used only
for the flagged, degraded last-resort route. Scale reference: NIST TN 2262 warns a 1-mile
buffer at 4 mi/h fire spread buys only ~15 minutes.

### 2.2 Evacuation time structure (UI wording, reroute behavior)

NIST TN 2262 (*WUI Fire Evacuation and Sheltering Considerations*, 2023) — WRSET = detection
+ notification + preparation + travel components; Paradise (Camp Fire 2018) took ≥ 4 h to
clear; trigger-zone sizing d = FS_max × t_evac.
https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.2262.pdf

### 2.3 Travel speeds (`NAV.defaultSpeedKmh`, `evacSpeedFactor`, `walkSpeedMps`)

- WUI evacuation microsimulation codes **25 mph residential / 40 mph highway** nominal limits
  (Li, Cova & Dennison 2019, verified verbatim).
- Real evacuations collapse far below nominal: NIST TN 2252 (Camp Fire reconstruction)
  documents **2–10 mi/h** observed evacuation flow in Paradise.
- We use real OSM `maxspeed` where mapped (7,310 edges carry signed limits; US format
  "25 mph" parsed per the OSM wiki), else class defaults anchored to California prima facie
  limits (CVC §22352: 25 mph in residence districts), then apply **evacSpeedFactor = 0.6**
  — between nominal and Camp-Fire collapse for a moderate, early, orderly evacuation. ETAs
  are therefore deliberately conservative.
- Walking: **1.2 m/s** (FHWA-RD-98-107, HCM pedestrian chapter default; 1.0 m/s for elderly
  populations). Pedestrians excluded from freeways.

### 2.4 Trigger-buffer asymmetry

WUIVAC buffers extend strongly **upwind** (fire travels downwind toward you) — reproduced
naturally here because clearance is evaluated against the anisotropic arrival-time field.

## 3. Kenneth Fire scenario facts (verified record)

| Fact | Value | Source |
| --- | --- | --- |
| Start | Jan 9 2025, 3:34 PM PT (official CAL FIRE record; first reports ~2:30 PM) | CAL FIRE incident page; LAFD INC#1365 |
| Origin | West end of Victory Blvd, West Hills (LAFD dispatch 24850 W Victory Blvd) | LAFD |
| Final size | 1,052 acres; forward progress stopped ~960 ac evening Jan 9 | CAL FIRE |
| Contained | Jan 12, 2025 | CAL FIRE |
| Structures destroyed | none | CAL FIRE |
| Evacuation order | Vanowen St→Burbank Blvd, County Lane Rd→Valley Circle Blvd; zones in West Hills, Hidden Hills, Calabasas N of US-101 | LAFD INC#1365; Genasys zones via ABC7 |
| Wind (observed, VNY ASOS 1–5 PM) | from 010–030° (N–NNE), sustained 15–22 mph, gusts 24–31 mph | https://mesonet.agron.iastate.edu (ASOS archive) |
| Humidity (observed) | 4.7–6.1% | same |
| Red Flag Warning | N–NE winds 20–35 mph, valley gusts 35–55 mph, RH 7–15% | NWS RFWLOX Jan 9 2025 18:27 UTC |

Model settings derived: wind FROM ~020° ⇒ spread bearing ~200–210°; 10-m wind 9 m/s
(≈20 mph sustained, gust-weighted) ⇒ midflame 0.4×9 ≈ **3.6 m/s**; `drynessFactor` set for
the observed ~5% RH critical dryness.

### Evacuation destinations (real, verified — coordinates from OSM)

| Destination | Address | Verification |
| --- | --- | --- |
| El Camino Real Charter High School | 5440 Valley Circle Blvd, Woodland Hills 91367 | City of LA / Cal OES designated evacuation center, Jan 2025 fires |
| Calvary Community Church | 5495 Via Rocas, Westlake Village 91362 | Shelter the City of Calabasas directed Kenneth Fire evacuees to |
| Pierce College | 6201 Winnetka Ave, Woodland Hills 91367 | Evacuation site (equestrian/large-animal center), Jan 2025 fires |

(Westfield Topanga could **not** be verified as a designated shelter and is deliberately not
used. Ritchie Valens Recreation Center, Pacoima — the successor shelter — lies outside the
navigation map.)

## 4. Positioning & guidance

- Smartphone GPS accuracy: **≈4.9 m radius open-sky** (GPS.gov, citing van Diggelen & Enge
  2015), worse near buildings; `GeolocationCoordinates.accuracy` is a 95%-confidence radius
  (W3C Geolocation spec) — drawn as the blue accuracy circle.
- `watchPosition` with `enableHighAccuracy: true`, finite timeout, small `maximumAge`
  (W3C spec + MDN guidance). Geolocation requires a secure context (HTTPS/localhost), hence
  the built-in demo placement mode.
- Voice prompts: Web Speech API speechSynthesis (Baseline, widely available since 2018; MDN).
  Chrome requires prior user activation — satisfied by the "Start" button press.

## 5. Live data sources

- **Streets:** OpenStreetMap via Overpass API, fetched at build time
  (`scripts/fetch-streets.mjs`), drivable public roads with names, oneway (incl.
  `junction=roundabout` ⇒ oneway), and `maxspeed`. © OpenStreetMap contributors, ODbL.
- **Elevation:** AWS Open Data Terrain Tiles at build time (`scripts/fetch-dem.mjs`), USGS
  3DEP/NED-derived, decoded from terrarium PNGs (formula verified from tilezen/joerd docs and
  live tiles).
- **Map/3D:** Google Maps JavaScript API `maps3d` (v=beta) photorealistic tiles.

## 6. Honest divergences from the research

1. The spread model is a FARSITE-family **minimum-travel-time approximation**, not full
   Rothermel chemistry: R0·fuel·dryness replaces the reaction-intensity term, with the
   researched ellipse, slope-equivalence, WAF, and wind exponent layered on top.
2. Fire–atmosphere feedback, crown fire, and plume-driven behavior are not modeled
   (WUIVAC has the same stated limitation).
3. Spot-fire placement is stochastic-illustrative (no accepted deterministic law exists);
   distances bounded by the observed record for moderate Santa Ana events.
4. Congestion is a fixed factor, not simulated traffic (Li et al. 2019 shows demand matters).
5. The historical stage rings remain a labelled reconstruction tuned to the official final
   acreage — not surveyed perimeters.
