-- Enable UUID generation and full-text search support
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER', 'VIEWER');
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');
CREATE TYPE "StatusCategory" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');
CREATE TYPE "SprintStatus" AS ENUM ('PLANNING', 'ACTIVE', 'COMPLETED');
CREATE TYPE "IssueType" AS ENUM ('EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK');
CREATE TYPE "Priority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "ActivityAction" AS ENUM ('CREATED', 'UPDATED', 'DELETED', 'STATUS_CHANGED', 'ASSIGNED', 'UNASSIGNED', 'COMMENTED', 'SPRINT_MOVED', 'SPRINT_STARTED', 'SPRINT_COMPLETED', 'WATCHED', 'UNWATCHED', 'CUSTOM_FIELD_UPDATED');
CREATE TYPE "NotificationType" AS ENUM ('ASSIGNED', 'MENTIONED', 'STATUS_CHANGED', 'COMMENT_ADDED', 'WATCHED_ISSUE_UPDATED', 'SPRINT_STARTED', 'SPRINT_COMPLETED');
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DROPDOWN', 'DATE');
CREATE TYPE "IssueRelationshipType" AS ENUM ('RELATES_TO', 'BLOCKS', 'BLOCKED_BY', 'DUPLICATES', 'DUPLICATED_BY');

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL UNIQUE,
  "password" text NOT NULL,
  "display_name" text NOT NULL,
  "avatar_url" text,
  "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
  "is_active" boolean NOT NULL DEFAULT true,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text,
  "owner_id" uuid NOT NULL,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE TABLE "workspace_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
  "joined_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  UNIQUE ("workspace_id", "user_id")
);

CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "description" text,
  "workspace_id" uuid,
  "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL
);

CREATE TABLE "project_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" "ProjectRole" NOT NULL DEFAULT 'MEMBER',
  "joined_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  UNIQUE ("project_id", "user_id")
);

CREATE TABLE "workflow_statuses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "name" text NOT NULL,
  "category" "StatusCategory" NOT NULL DEFAULT 'TODO',
  "color" text NOT NULL DEFAULT '#6B7280',
  "position" integer NOT NULL DEFAULT 0,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workflow_statuses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  UNIQUE ("project_id", "name")
);

CREATE TABLE "workflow_transitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "from_status_id" uuid NOT NULL,
  "to_status_id" uuid NOT NULL,
  "name" text,
  "conditions" jsonb,
  "actions" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workflow_transitions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "workflow_transitions_from_status_id_fkey" FOREIGN KEY ("from_status_id") REFERENCES "workflow_statuses"("id") ON DELETE CASCADE,
  CONSTRAINT "workflow_transitions_to_status_id_fkey" FOREIGN KEY ("to_status_id") REFERENCES "workflow_statuses"("id") ON DELETE CASCADE,
  UNIQUE ("project_id", "from_status_id", "to_status_id")
);

CREATE TABLE "automation_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "name" text NOT NULL,
  "trigger" jsonb NOT NULL,
  "actions" jsonb NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "automation_rules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
);

CREATE TABLE "sprints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "name" text NOT NULL,
  "goal" text,
  "status" "SprintStatus" NOT NULL DEFAULT 'PLANNING',
  "start_date" timestamptz,
  "end_date" timestamptz,
  "completed_at" timestamptz,
  "velocity" double precision,
  "deleted_at" timestamptz,
  "created_by_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sprints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "sprints_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE TABLE "issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL UNIQUE,
  "project_id" uuid NOT NULL,
  "workspace_id" uuid,
  "sprint_id" uuid,
  "parent_id" uuid,
  "status_id" uuid NOT NULL,
  "type" "IssueType" NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
  "story_points" double precision,
  "assignee_id" uuid,
  "reporter_id" uuid NOT NULL,
  "labels" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "version" integer NOT NULL DEFAULT 1,
  "due_date" timestamptz,
  "resolved_at" timestamptz,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "issues_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "issues_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL,
  CONSTRAINT "issues_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id"),
  CONSTRAINT "issues_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "issues"("id"),
  CONSTRAINT "issues_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "workflow_statuses"("id"),
  CONSTRAINT "issues_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id"),
  CONSTRAINT "issues_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id")
);

CREATE TABLE "issue_relationships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "related_issue_id" uuid NOT NULL,
  "relationship_type" "IssueRelationshipType" NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "issue_relationships_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "issue_relationships_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE,
  CONSTRAINT "issue_relationships_related_issue_id_fkey" FOREIGN KEY ("related_issue_id") REFERENCES "issues"("id") ON DELETE CASCADE,
  UNIQUE ("issue_id", "related_issue_id", "relationship_type")
);

CREATE TABLE "comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "issue_id" uuid NOT NULL,
  "author_id" uuid NOT NULL,
  "parent_id" uuid,
  "content" text NOT NULL,
  "mentions" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "is_edited" boolean NOT NULL DEFAULT false,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "comments_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE,
  CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "comments"("id")
);

CREATE TABLE "activity_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "issue_id" uuid,
  "user_id" uuid NOT NULL,
  "action" "ActivityAction" NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "changes" jsonb,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "activity_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "activity_logs_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id"),
  CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id")
);

CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "issue_id" uuid,
  "project_id" uuid,
  "is_read" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE "issue_watchers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "issue_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "issue_watchers_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE,
  CONSTRAINT "issue_watchers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
  UNIQUE ("issue_id", "user_id")
);

CREATE TABLE "custom_fields" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "name" text NOT NULL,
  "type" "CustomFieldType" NOT NULL,
  "options" jsonb,
  "is_required" boolean NOT NULL DEFAULT false,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "custom_fields_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  UNIQUE ("project_id", "name")
);

CREATE TABLE "custom_field_values" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "custom_field_id" uuid NOT NULL,
  "issue_id" uuid NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "custom_field_values_custom_field_id_fkey" FOREIGN KEY ("custom_field_id") REFERENCES "custom_fields"("id") ON DELETE CASCADE,
  CONSTRAINT "custom_field_values_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE,
  UNIQUE ("custom_field_id", "issue_id")
);

CREATE INDEX "idx_issues_project_id" ON "issues" ("project_id");
CREATE INDEX "idx_issues_workspace_id" ON "issues" ("workspace_id");
CREATE INDEX "idx_issues_sprint_id" ON "issues" ("sprint_id");
CREATE INDEX "idx_issues_status_id" ON "issues" ("status_id");
CREATE INDEX "idx_issues_assignee_id" ON "issues" ("assignee_id");
CREATE INDEX "idx_issues_parent_id" ON "issues" ("parent_id");
CREATE INDEX "idx_issues_type" ON "issues" ("type");
CREATE INDEX "idx_issues_priority" ON "issues" ("priority");
CREATE INDEX "idx_issues_created_at" ON "issues" ("created_at");
CREATE INDEX "idx_issues_deleted_at" ON "issues" ("deleted_at");
CREATE INDEX "idx_activity_logs_project_id" ON "activity_logs" ("project_id");
CREATE INDEX "idx_activity_logs_issue_id" ON "activity_logs" ("issue_id");
CREATE INDEX "idx_activity_logs_user_id" ON "activity_logs" ("user_id");
CREATE INDEX "idx_notifications_user_id" ON "notifications" ("user_id");
CREATE INDEX "idx_notifications_is_read" ON "notifications" ("is_read");
CREATE INDEX "idx_comments_issue_id" ON "comments" ("issue_id");
CREATE INDEX "idx_comments_author_id" ON "comments" ("author_id");
CREATE INDEX "idx_comments_deleted_at" ON "comments" ("deleted_at");
CREATE INDEX "idx_project_members_project_id" ON "project_members" ("project_id");
CREATE INDEX "idx_workspace_members_workspace_id" ON "workspace_members" ("workspace_id");

CREATE INDEX "idx_issue_fulltext" ON "issues" USING GIN (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", '')));
CREATE INDEX "idx_comment_fulltext" ON "comments" USING GIN (to_tsvector('english', coalesce("content", '')));
