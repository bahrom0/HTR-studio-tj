-- Stage 6: one current user edit per recognized line.
-- raw_text remains immutable on line_results; edited_text is a separately
-- versioned user value, so later OCR attempts never overwrite a correction.

BEGIN;

WITH ranked_edits AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY line_result_id
      ORDER BY updated_at DESC, version DESC, id DESC
    ) AS position
  FROM public.text_edits
)
DELETE FROM public.text_edits AS text_edit
USING ranked_edits
WHERE text_edit.id = ranked_edits.id
  AND ranked_edits.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_text_edits_one_current_per_line_result
  ON public.text_edits (line_result_id);

COMMIT;
