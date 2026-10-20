-- Replace guard_admin_user_escalation to ignore avatarUrl and phone when comparing permissions
CREATE OR REPLACE FUNCTION guard_admin_user_escalation()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.current_role', true) IS DISTINCT FROM 'super_admin' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Privilege escalation rejected: non-super-admin cannot alter role'
        USING ERRCODE = '42501';
    END IF;
    IF (COALESCE(NEW.permissions::jsonb, '{}'::jsonb) - 'avatarUrl' - 'phone') IS DISTINCT FROM 
       (COALESCE(OLD.permissions::jsonb, '{}'::jsonb) - 'avatarUrl' - 'phone') THEN
      RAISE EXCEPTION 'Privilege escalation rejected: non-super-admin cannot alter permissions'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Privilege escalation rejected: non-super-admin cannot alter status'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
