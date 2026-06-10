Place the NASA FIRMS archive CSV for the Kenneth Fire here as:

  kenneth_firms.csv

How to get it:
  1. Go to https://firms.modaps.eosdis.nasa.gov/download/ (free Earthdata login).
  2. Create an archive download request:
       - Area: draw a box around West Hills / Calabasas, CA
         (suggested bounds: West -118.78, South 34.12, East -118.56, North 34.26)
       - Dates: 2025-01-09 through 2025-01-13 (FIRMS dates are UTC; Jan 13 UTC
         covers the evening of Jan 12 Pacific time)
       - Source: VIIRS (S-NPP and/or NOAA-20/NOAA-21), CSV format
  3. Extract the emailed/downloaded archive and save the CSV in this folder as
     kenneth_firms.csv.

Notes:
  - Expected columns: latitude, longitude, acq_date, acq_time, satellite,
    confidence, frp, bright_ti4 (MODIS files with `brightness` also work).
  - If FIRMS gives you one CSV per sensor, you can concatenate them; repeated
    header lines are ignored by the app.
  - The app keeps only detections within ~6 km of the Kenneth Fire ignition
    point, so detections from other January 2025 incidents (e.g. the
    Palisades Fire) in the same download are excluded automatically.
