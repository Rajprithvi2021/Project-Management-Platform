import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create users
  const passwordHash = await bcrypt.hash('Password123!', 12);

  const alice = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: {
      email: 'alice@example.com',
      password: passwordHash,
      displayName: 'Alice Johnson',
      role: 'ADMIN',
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: {
      email: 'bob@example.com',
      password: passwordHash,
      displayName: 'Bob Chen',
      role: 'MEMBER',
    },
  });

  const jane = await prisma.user.upsert({
    where: { email: 'jane@example.com' },
    update: {},
    create: {
      email: 'jane@example.com',
      password: passwordHash,
      displayName: 'Jane Smith',
      role: 'MEMBER',
    },
  });

  console.log('✅ Users created');

  // Create project
  const existingProject = await prisma.project.findUnique({ where: { key: 'PROJ' } });
  if (existingProject) {
    console.log('Project already exists, skipping...');
    return;
  }

  const project = await prisma.project.create({
    data: { key: 'PROJ', name: 'Demo Project', description: 'Sample project for demonstration' },
  });

  // Add members
  await prisma.projectMember.createMany({
    data: [
      { projectId: project.id, userId: alice.id, role: 'OWNER' },
      { projectId: project.id, userId: bob.id, role: 'MEMBER' },
      { projectId: project.id, userId: jane.id, role: 'MEMBER' },
    ],
  });

  // Create workflow statuses
  const todoStatus = await prisma.workflowStatus.create({
    data: { projectId: project.id, name: 'To Do', category: 'TODO', color: '#6B7280', position: 0, isDefault: true },
  });
  const inProgressStatus = await prisma.workflowStatus.create({
    data: { projectId: project.id, name: 'In Progress', category: 'IN_PROGRESS', color: '#3B82F6', position: 1 },
  });
  const inReviewStatus = await prisma.workflowStatus.create({
    data: { projectId: project.id, name: 'In Review', category: 'IN_PROGRESS', color: '#F59E0B', position: 2 },
  });
  const doneStatus = await prisma.workflowStatus.create({
    data: { projectId: project.id, name: 'Done', category: 'DONE', color: '#10B981', position: 3 },
  });

  // Create workflow transitions
  await prisma.workflowTransition.createMany({
    data: [
      { projectId: project.id, fromStatusId: todoStatus.id, toStatusId: inProgressStatus.id, name: 'Start Progress' },
      { projectId: project.id, fromStatusId: inProgressStatus.id, toStatusId: inReviewStatus.id, name: 'Submit for Review' },
      { projectId: project.id, fromStatusId: inReviewStatus.id, toStatusId: inProgressStatus.id, name: 'Request Changes' },
      { projectId: project.id, fromStatusId: inReviewStatus.id, toStatusId: doneStatus.id, name: 'Approve & Close',
        actions: [{ type: 'SET_PRIORITY', priority: 'LOW' }] },
      { projectId: project.id, fromStatusId: inProgressStatus.id, toStatusId: todoStatus.id, name: 'Stop Progress' },
      { projectId: project.id, fromStatusId: doneStatus.id, toStatusId: inProgressStatus.id, name: 'Reopen' },
    ] as any,
  });

  console.log('✅ Workflow configured');

  // Create sprint
  const sprint = await prisma.sprint.create({
    data: {
      projectId: project.id,
      name: 'Sprint 1',
      goal: 'Deliver authentication and core issue management',
      status: 'ACTIVE',
      startDate: new Date('2024-01-15'),
      endDate: new Date('2024-01-29'),
      createdById: alice.id,
    },
  });

  console.log('✅ Sprint created');

  // Create issues
  const epic = await prisma.issue.create({
    data: {
      key: 'PROJ-1',
      projectId: project.id,
      type: 'EPIC',
      title: 'User Authentication System',
      description: 'Complete authentication flow including OAuth 2.0',
      priority: 'HIGH',
      reporterId: alice.id,
      statusId: inProgressStatus.id,
      storyPoints: 21,
      labels: ['auth', 'backend'],
      sprintId: sprint.id,
    },
  });

  const story1 = await prisma.issue.create({
    data: {
      key: 'PROJ-2',
      projectId: project.id,
      type: 'STORY',
      title: 'Add user authentication via OAuth',
      description: 'Implement OAuth 2.0 login flow with Google and GitHub',
      priority: 'HIGH',
      assigneeId: jane.id,
      reporterId: bob.id,
      parentId: epic.id,
      statusId: inProgressStatus.id,
      storyPoints: 5,
      labels: ['auth', 'backend'],
      sprintId: sprint.id,
    },
  });

  await prisma.issue.create({
    data: {
      key: 'PROJ-3',
      projectId: project.id,
      type: 'STORY',
      title: 'JWT token refresh mechanism',
      description: 'Implement refresh token rotation',
      priority: 'MEDIUM',
      assigneeId: bob.id,
      reporterId: alice.id,
      parentId: epic.id,
      statusId: todoStatus.id,
      storyPoints: 3,
      sprintId: sprint.id,
    },
  });

  await prisma.issue.create({
    data: {
      key: 'PROJ-4',
      projectId: project.id,
      type: 'BUG',
      title: 'Login fails with special characters in password',
      description: 'Users with @, # in passwords cannot log in',
      priority: 'CRITICAL',
      assigneeId: jane.id,
      reporterId: bob.id,
      statusId: todoStatus.id,
      storyPoints: 1,
      labels: ['bug', 'auth'],
      sprintId: sprint.id,
    },
  });

  await prisma.issue.create({
    data: {
      key: 'PROJ-5',
      projectId: project.id,
      type: 'TASK',
      title: 'Set up project board in backlog',
      description: 'This issue has no sprint assigned — backlog item',
      priority: 'LOW',
      reporterId: alice.id,
      statusId: todoStatus.id,
      storyPoints: 2,
    },
  });

  // Add watchers
  await prisma.issueWatcher.createMany({
    data: [
      { issueId: story1.id, userId: alice.id },
      { issueId: story1.id, userId: jane.id },
      { issueId: story1.id, userId: bob.id },
    ],
    skipDuplicates: true,
  });

  // Add comments
  const comment = await prisma.comment.create({
    data: {
      issueId: story1.id,
      authorId: bob.id,
      content: 'We need to support Google and GitHub OAuth providers. @[Jane Smith](jane-id) can you take a look at the Google docs?',
      mentions: [jane.id],
    },
  });

  await prisma.comment.create({
    data: {
      issueId: story1.id,
      authorId: jane.id,
      parentId: comment.id,
      content: 'Sure! I have already reviewed the Google OAuth 2.0 documentation. Will start implementation today.',
    },
  });

  // Add custom fields
  const stageField = await prisma.customField.create({
    data: {
      projectId: project.id,
      name: 'Stage',
      type: 'DROPDOWN',
      options: ['Planning', 'Development', 'Testing', 'Released'],
      position: 0,
    },
  });

  await prisma.customFieldValue.create({
    data: {
      customFieldId: stageField.id,
      issueId: story1.id,
      value: 'Development',
    },
  });

  // Add activity logs
  await prisma.activityLog.createMany({
    data: [
      {
        projectId: project.id,
        issueId: epic.id,
        userId: alice.id,
        action: 'CREATED',
        entityType: 'Issue',
        entityId: epic.id,
      },
      {
        projectId: project.id,
        issueId: story1.id,
        userId: bob.id,
        action: 'CREATED',
        entityType: 'Issue',
        entityId: story1.id,
      },
    ],
  });

  console.log('✅ Issues, comments, and activity logs created');
  console.log('');
  console.log('🎉 Seed complete!');
  console.log('');
  console.log('Test credentials:');
  console.log('  alice@example.com / Password123!  (Admin)');
  console.log('  bob@example.com   / Password123!  (Member)');
  console.log('  jane@example.com  / Password123!  (Member)');
  console.log('');
  console.log(`Project key: PROJ (id: ${project.id})`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
