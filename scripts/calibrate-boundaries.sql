-- Calibrates the per-portal boundary inset: real neighbouring plots must neither overlap nor leave
-- gaps.
WITH u AS (
  SELECT DISTINCT ON (p."villageId", p."khasraNo") p.id, v.name village,
         ST_Transform(p.geom, CASE WHEN v.name='Akbarpur' THEN 32644 ELSE 32643 END) g
    FROM "LandParcel" p JOIN "Village" v ON v.id=p."villageId"),
d AS (SELECT unnest(ARRAY[0]) d),
b AS (SELECT u.id, u.village, d.d, ST_Buffer(u.g, -d.d, 'join=mitre mitre_limit=5') g FROM u, d),
pairs AS (
  SELECT a.village, a.d, ST_Area(ST_Intersection(a.g,b.g)) ov, ST_Distance(a.g,b.g) dist,
         -- shared edge length measured on the unbuffered geometry
         ST_Length(ST_Intersection(ST_Boundary(ua.g), ST_Buffer(ub.g, 0.5))) shared
    FROM b a JOIN b b ON a.id<b.id AND a.village=b.village AND a.d=b.d
    JOIN u ua ON ua.id=a.id JOIN u ub ON ub.id=b.id
   WHERE ST_DWithin(ua.g, ub.g, 0.5))
SELECT village, d inset_m, count(*) FILTER (WHERE shared>5) neighbours,
       round(sum(ov)::numeric,1) total_overlap_m2,
       round((sum(ov) FILTER (WHERE shared>5) / NULLIF(sum(shared) FILTER (WHERE shared>5),0))::numeric,3) overlap_width_m,
       count(*) FILTER (WHERE shared>5 AND dist>0.05) gapped_pairs
  FROM pairs GROUP BY 1,2 ORDER BY 1,2;
