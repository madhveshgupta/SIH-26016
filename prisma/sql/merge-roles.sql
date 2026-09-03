-- 10 roles → 8.

BEGIN;

UPDATE "User" u SET "roleId" = (SELECT id FROM "Role" WHERE type::text = 'LAND_REQUIRING_BODY')
  FROM "Role" r WHERE r.id = u."roleId" AND r.type::text = 'PROJECT_IMPLEMENTING_AGENCY';
UPDATE "User" u SET "roleId" = (SELECT id FROM "Role" WHERE type::text = 'CENTRAL_MINISTRY')
  FROM "Role" r WHERE r.id = u."roleId" AND r.type::text = 'POLICY_MAKER';

UPDATE "Proposal" SET "currentHolderRole" = 'LAND_REQUIRING_BODY' WHERE "currentHolderRole"::text = 'PROJECT_IMPLEMENTING_AGENCY';
UPDATE "Proposal" SET "currentHolderRole" = 'CENTRAL_MINISTRY'    WHERE "currentHolderRole"::text = 'POLICY_MAKER';
UPDATE "ProposalStage" SET "actorRole" = 'LAND_REQUIRING_BODY' WHERE "actorRole"::text = 'PROJECT_IMPLEMENTING_AGENCY';
UPDATE "ProposalStage" SET "actorRole" = 'CENTRAL_MINISTRY'    WHERE "actorRole"::text = 'POLICY_MAKER';
UPDATE "Grievance" SET "authorityRole" = 'LAND_REQUIRING_BODY' WHERE "authorityRole"::text = 'PROJECT_IMPLEMENTING_AGENCY';
UPDATE "Grievance" SET "authorityRole" = 'CENTRAL_MINISTRY'    WHERE "authorityRole"::text = 'POLICY_MAKER';

DELETE FROM "Role" WHERE type::text IN ('PROJECT_IMPLEMENTING_AGENCY', 'POLICY_MAKER');

COMMIT;
