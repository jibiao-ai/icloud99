-- Add svg_code column to store SVG animation source code from GPT
ALTER TABLE iq_tests ADD COLUMN svg_code TEXT DEFAULT '';
