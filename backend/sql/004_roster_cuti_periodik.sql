-- Pisahkan cuti periodik (CP) dari cuti khusus/manual (C).
ALTER TABLE roster_template_days
  DROP CONSTRAINT IF EXISTS roster_template_days_status_check;
ALTER TABLE employee_roster_daily
  DROP CONSTRAINT IF EXISTS employee_roster_daily_status_check;

-- Semua C pada template lama berasal dari blok cuti periodik generator.
UPDATE roster_template_days SET status='CP' WHERE status='C';
UPDATE employee_roster_daily SET status='CP'
WHERE status='C' AND source='generated';

ALTER TABLE roster_template_days
  ADD CONSTRAINT roster_template_days_status_check
  CHECK (status IN ('S','M','C','CP','OFF'));
ALTER TABLE employee_roster_daily
  ADD CONSTRAINT employee_roster_daily_status_check
  CHECK (status IN ('S','M','C','CP','OFF'));
