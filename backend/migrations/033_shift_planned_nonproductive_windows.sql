BEGIN;

-- Planned non-productive windows used by running production targets.
-- Actual ritase/production remains recorded during these windows; only the
-- planned target duration is excluded.
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS change_shift_start TIME,
  ADD COLUMN IF NOT EXISTS change_shift_end TIME,
  ADD COLUMN IF NOT EXISTS break_start TIME,
  ADD COLUMN IF NOT EXISTS break_end TIME;

UPDATE shifts
SET change_shift_start = COALESCE(change_shift_start, TIME '06:00'),
    change_shift_end = COALESCE(change_shift_end, TIME '07:00'),
    break_start = COALESCE(break_start, TIME '12:00'),
    break_end = COALESCE(break_end, TIME '13:00')
WHERE operational_start = TIME '06:00'
  AND operational_end = TIME '18:00';

UPDATE shifts
SET change_shift_start = COALESCE(change_shift_start, TIME '18:00'),
    change_shift_end = COALESCE(change_shift_end, TIME '19:00'),
    break_start = COALESCE(break_start, TIME '00:00'),
    break_end = COALESCE(break_end, TIME '01:00')
WHERE operational_start = TIME '18:00'
  AND operational_end = TIME '06:00';

ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_change_shift_window_check;
ALTER TABLE shifts ADD CONSTRAINT shifts_change_shift_window_check CHECK (
  (change_shift_start IS NULL AND change_shift_end IS NULL)
  OR (change_shift_start IS NOT NULL AND change_shift_end IS NOT NULL AND change_shift_start <> change_shift_end)
);

ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_break_window_check;
ALTER TABLE shifts ADD CONSTRAINT shifts_break_window_check CHECK (
  (break_start IS NULL AND break_end IS NULL)
  OR (break_start IS NOT NULL AND break_end IS NOT NULL AND break_start <> break_end)
);

COMMENT ON COLUMN shifts.change_shift_start IS 'Awal Change Shift yang tidak dibebani target produksi berjalan.';
COMMENT ON COLUMN shifts.change_shift_end IS 'Akhir Change Shift yang tidak dibebani target produksi berjalan.';
COMMENT ON COLUMN shifts.break_start IS 'Awal istirahat yang tidak dibebani target produksi berjalan.';
COMMENT ON COLUMN shifts.break_end IS 'Akhir istirahat yang tidak dibebani target produksi berjalan.';

COMMIT;
