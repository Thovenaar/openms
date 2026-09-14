ALTER TABLE custom_content DROP CONSTRAINT IF EXISTS custom_content_kind_check;
ALTER TABLE custom_content ADD CONSTRAINT custom_content_kind_check CHECK(kind IN ('map','mob','quest','drops','dialogue'));
