import type { Account, GitHubCommitOperation, GitHubConnection, Playground, PlaygroundInvitation, PlaygroundMember, TemplateFile, User } from '@prisma/client';

// Mock data for development
const mockPlaygrounds: Playground[] = [
  {
    id: 'mock-playground-1',
    title: 'React TypeScript Starter',
    description: 'A basic React TypeScript project',
    template: 'REACT',
    userId: 'mock-user-1',
    collaborationRevision: 1,
    githubSource: null,
    githubCommitLock: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'mock-playground-2',
    title: 'Next.js Starter',
    description: 'A basic Next.js project',
    template: 'NEXTJS',
    userId: 'mock-user-1',
    collaborationRevision: 1,
    githubSource: null,
    githubCommitLock: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const mockTemplateFiles: TemplateFile[] = [];

const mockUsers: User[] = [
  {
    id: 'mock-user-1',
    name: 'Local Developer',
    email: 'developer@localhost',
    image: null,
    role: 'USER',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'mock-user-2',
    name: 'Project Collaborator',
    email: 'collaborator@example.com',
    image: null,
    role: 'USER',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const mockStarMarks: Array<{
  id: string;
  userId: string;
  playgroundId: string;
  isMarked: boolean;
  createdAt: Date;
}> = [];

const mockAccounts: Account[] = [];
const mockPlaygroundMembers: PlaygroundMember[] = [];
const mockInvitations: PlaygroundInvitation[] = [];
let transactionQueue: Promise<unknown> = Promise.resolve();
function matchesInvitation(invitation: PlaygroundInvitation, where: any) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'expiresAt' && value && typeof value === 'object' && 'gt' in value) return invitation.expiresAt > (value as { gt: Date }).gt;
    return invitation[key as keyof PlaygroundInvitation] === value;
  });
}
const mockCollaborationDocuments: Array<{
  id: string;
  room: string;
  filePath: string;
  state: string;
  playgroundId: string;
  createdAt: Date;
  updatedAt: Date;
}> = [];
const mockPlaygroundSnapshots: any[] = [];
const mockPlaygroundHistoryEvents: any[] = [];
const mockChatMessages: Array<{
  id: string;
  userId: string;
  playgroundId: string;
  role: string;
  content: string;
  createdAt: Date;
}> = [];

const mockGitHubConnections: GitHubConnection[] = [];
const mockGitHubCommitOperations: GitHubCommitOperation[] = [];
function copySelected(record: any, select?: Record<string, boolean>) {
  if (!record) return null;
  return structuredClone(select ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, record[key]])) : record);
}
function matchesRecord(record: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((part: any) => matchesRecord(record, part));
    if (key === 'AND') return value.every((part: any) => matchesRecord(record, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('isSet' in value) return (record[key] !== undefined) === value.isSet;
      if ('in' in value) return value.in.includes(record[key]);
      if ('lt' in value) return record[key] < value.lt;
      if ('gt' in value) return record[key] > value.gt;
    }
    return value === null ? record[key] == null : record[key] === value;
  });
}
function matchesGitHubConnection(record: GitHubConnection, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "pendingExpiresAt" && value && typeof value === "object" && "gt" in value) return !!record.pendingExpiresAt && record.pendingExpiresAt > (value as { gt: Date }).gt;
    return record[key as keyof GitHubConnection] === value;
  });
}
const createMockDb = () => ({
  gitHubCommitOperation: {
    create: async ({ data }: any) => {
      const operation: GitHubCommitOperation = { id: crypto.randomUUID(), blobIndex: 0, treeSha: null, commitSha: null, leaseOwner: null, leaseUntil: null, errorCode: null, createdAt: new Date(), updatedAt: new Date(), ...data };
      if (mockGitHubCommitOperations.some(item => item.id === operation.id)) throw Object.assign(new Error('Duplicate operation'), { code: 'P2002' });
      mockGitHubCommitOperations.push(operation); return structuredClone(operation);
    },
    findUnique: async ({ where }: any) => { const operation = mockGitHubCommitOperations.find(item => matchesRecord(item, where)); return operation ? structuredClone(operation) : null; },
    findMany: async ({ where, take }: any) => mockGitHubCommitOperations.filter(item => matchesRecord(item, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take).map(item => structuredClone(item)),
    updateMany: async ({ where, data }: any) => { const records = mockGitHubCommitOperations.filter(item => matchesRecord(item, where)); records.forEach(item => Object.assign(item, data, { updatedAt: new Date() })); return { count: records.length }; },
  },
  gitHubConnection: {
    findUnique: async ({ where }: { where: { userId: string } }) => {
      const record = mockGitHubConnections.find(item => item.userId === where.userId);
      return record ? structuredClone(record) : null;
    },
    upsert: async ({ where, create, update }: { where: { userId: string }; create: Partial<GitHubConnection> & { userId: string; version: string }; update: Partial<GitHubConnection> }) => {
      let record = mockGitHubConnections.find(item => item.userId === where.userId);
      if (record) Object.assign(record, update, { updatedAt: new Date() });
      else {
        record = { id: crypto.randomUUID(), encryptedToken: null, githubUserId: null, login: null, access: null, scopes: null,
          connectedAt: null, revokedAt: null, pendingStateHash: null, pendingVerifier: null, pendingExpiresAt: null,
          pendingAccess: null, writeEnabled: false, pendingWrite: null, createdAt: new Date(), updatedAt: new Date(), ...create };
        mockGitHubConnections.push(record);
      }
      return structuredClone(record);
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<GitHubConnection> }) => {
      const matches = mockGitHubConnections.filter(item => matchesGitHubConnection(item, where));
      matches.forEach(item => Object.assign(item, data, { updatedAt: new Date() }));
      return { count: matches.length };
    },
  },
  // Development fixture only; production uses MongoDB/Prisma transactions.
  $transaction: async (callback: (client: any) => Promise<any>): Promise<any> => {
    const run = transactionQueue.then(async () => {
      const invitations = structuredClone(mockInvitations);
      const members = structuredClone(mockPlaygroundMembers);
      const projects = structuredClone(mockPlaygrounds);
      const files = structuredClone(mockTemplateFiles);
      const operations = structuredClone(mockGitHubCommitOperations);
      const snapshots = structuredClone(mockPlaygroundSnapshots);
      const events = structuredClone(mockPlaygroundHistoryEvents);
      const chat = structuredClone(mockChatMessages);
      const documents = structuredClone(mockCollaborationDocuments);
      try { return await callback(mockDb); }
      catch (error) {
        mockInvitations.splice(0, mockInvitations.length, ...invitations);
        mockPlaygroundMembers.splice(0, mockPlaygroundMembers.length, ...members);
        mockPlaygrounds.splice(0, mockPlaygrounds.length, ...projects);
        mockTemplateFiles.splice(0, mockTemplateFiles.length, ...files);
        mockGitHubCommitOperations.splice(0, mockGitHubCommitOperations.length, ...operations);
        mockPlaygroundSnapshots.splice(0, mockPlaygroundSnapshots.length, ...snapshots);
        mockPlaygroundHistoryEvents.splice(0, mockPlaygroundHistoryEvents.length, ...events);
        mockChatMessages.splice(0, mockChatMessages.length, ...chat);
        mockCollaborationDocuments.splice(0, mockCollaborationDocuments.length, ...documents);
        throw error;
      }
    });
    transactionQueue = run.catch(() => {});
    return run;
  },
  playgroundInvitation: {
    create: async ({ data }: any) => {
      const invitation: PlaygroundInvitation = { ...data, id: crypto.randomUUID(), createdAt: new Date(), usedAt: null, usedById: null, revokedAt: null };
      mockInvitations.push(invitation); return invitation;
    },
    findUnique: async ({ where, include }: any) => {
      const invitation = mockInvitations.find(item => matchesInvitation(item, where));
      if (!invitation) return null;
      return include?.playground ? { ...invitation, playground: mockPlaygrounds.find(project => project.id === invitation.playgroundId) } : invitation;
    },
    findMany: async ({ where, take, select }: any) => mockInvitations.filter(item => matchesInvitation(item, where))
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, take)
      .map(item => select ? Object.fromEntries(Object.keys(select).map(key => [key, item[key as keyof PlaygroundInvitation]])) : { ...item }),
    updateMany: async ({ where, data }: any) => {
      const matches = mockInvitations.filter(item => matchesInvitation(item, where));
      matches.forEach(item => Object.assign(item, data)); return { count: matches.length };
    },
  },
  playground: {
    findUniqueOrThrow: async ({ where }: any) => {
      const project = mockPlaygrounds.find(project => project.id === where.id);
      if (!project) throw new Error("Playground not found");
      return project;
    },
    findUnique: async ({ where, include, select }: any) => {
      const playground = mockPlaygrounds.find(p => p.id === where.id);
      if (!playground) return null;
      if (include?.templateFiles) {
        return { ...playground, templateFiles: mockTemplateFiles.filter(t => t.playgroundId === playground.id) };
      }
      if (select?.templateFiles) {
        return {
          id: playground.id,
          title: playground.title,
          description: playground.description,
          template: playground.template,
          githubSource: playground.githubSource,
          templateFiles: mockTemplateFiles
            .filter(t => t.playgroundId === playground.id)
            .map(t => ({ content: t.content, version: t.version })),
        };
      }
      return playground;
    },
    findMany: async ({ where }: any = {}) => {
      const requestedUserId = where?.userId || where?.OR?.[0]?.userId;
      const memberUserId = where?.OR?.[1]?.members?.some?.userId;
      const playgrounds = requestedUserId || memberUserId
        ? mockPlaygrounds.filter(p => p.userId === requestedUserId || mockPlaygroundMembers.some(m => m.playgroundId === p.id && m.userId === memberUserId))
        : mockPlaygrounds;

      return playgrounds.map(playground => ({
        ...playground,
        user: mockUsers.find(user => user.id === playground.userId),
        Starmark: mockStarMarks.filter(mark =>
          mark.playgroundId === playground.id && (!where?.userId || mark.userId === where.userId)
        ),
      }));
    },
    create: async (data: any) => {
      const { templateFiles, ...playgroundData } = data.data;
      const newPlayground = {
        ...playgroundData,
        id: playgroundData.id ?? crypto.randomUUID(),
        githubSource: playgroundData.githubSource ?? null,
        githubCommitLock: playgroundData.githubCommitLock ?? null,
        collaborationRevision: playgroundData.collaborationRevision ?? 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      if (mockPlaygrounds.some(project => project.id === newPlayground.id)) throw Object.assign(new Error('Duplicate project'), { code: 'P2002' });
      mockPlaygrounds.push(newPlayground);
      for (const file of templateFiles?.create || []) {
        mockTemplateFiles.push({
          id: `mock-template-${Date.now()}-${mockTemplateFiles.length}`,
          playgroundId: newPlayground.id,
          content: file.content,
          version: file.version ?? 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return newPlayground;
    },
    update: async ({ where, data }: { where: { id: string }, data: any }) => {
      const index = mockPlaygrounds.findIndex(p => p.id === where.id);
      if (index !== -1) {
        const collaborationRevision = data.collaborationRevision?.increment
          ? mockPlaygrounds[index].collaborationRevision + data.collaborationRevision.increment
          : data.collaborationRevision ?? mockPlaygrounds[index].collaborationRevision;
        mockPlaygrounds[index] = { ...mockPlaygrounds[index], ...data, collaborationRevision, updatedAt: data.updatedAt ?? new Date() };
        return mockPlaygrounds[index];
      }
      return null;
    },
    updateMany: async ({ where, data }: any) => {
      const matches = mockPlaygrounds.filter(project => matchesRecord(project, where));
      matches.forEach(project => Object.assign(project, data)); return { count: matches.length };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = mockPlaygrounds.findIndex(p => p.id === where.id);
      if (index !== -1) {
        const deleted = mockPlaygrounds.splice(index, 1)[0];
        return deleted;
      }
      return null;
    }
  },
  templateFile: {
    findFirst: async ({ where }: { where: { playgroundId: string } }) => {
      return mockTemplateFiles.find(t => t.playgroundId === where.playgroundId) || null;
    },
    findUnique: async ({ where }: { where: { playgroundId: string } }) => {
      return mockTemplateFiles.find(t => t.playgroundId === where.playgroundId) || null;
    },
    create: async (data: any) => {
      const newTemplateFile = {
        ...data.data,
        id: `mock-template-${Date.now()}`,
        version: data.data.version ?? 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockTemplateFiles.push(newTemplateFile);
      return newTemplateFile;
    },
    update: async ({ where, data }: { where: { playgroundId: string }, data: any }) => {
      const index = mockTemplateFiles.findIndex(t => t.playgroundId === where.playgroundId);
      if (index !== -1) {
        mockTemplateFiles[index] = { ...mockTemplateFiles[index], ...data, updatedAt: new Date() };
        return mockTemplateFiles[index];
      }
      return null;
    },
    upsert: async ({ where, update, create }: any) => {
      const existing = mockTemplateFiles.find(t => t.playgroundId === where.playgroundId);
      if (existing) {
        const nextVersion = update.version?.increment
          ? existing.version + update.version.increment
          : update.version ?? existing.version;
        Object.assign(existing, update, { version: nextVersion, updatedAt: new Date() });
        return existing;
      }
      const created = {
        ...create,
        id: `mock-template-${Date.now()}`,
        version: create.version ?? 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockTemplateFiles.push(created);
      return created;
    },
    updateMany: async ({ where, data }: any) => {
      const existing = mockTemplateFiles.find(t =>
        t.playgroundId === where.playgroundId &&
        (where.version === undefined || t.version === where.version)
      );
      if (!existing) return { count: 0 };
      const nextVersion = data.version?.increment
        ? existing.version + data.version.increment
        : data.version ?? existing.version;
      Object.assign(existing, data, { version: nextVersion, updatedAt: new Date() });
      return { count: 1 };
    },
    findUniqueOrThrow: async ({ where }: any) => {
      const existing = mockTemplateFiles.find(t => t.playgroundId === where.playgroundId);
      if (!existing) throw new Error('Template file not found');
      return existing;
    },
  },
  user: {
    findUnique: async ({ where }: any) => {
      return mockUsers.find(u =>
        (where.id && u.id === where.id) || (where.email && u.email === where.email)
      ) || null;
    },
    create: async ({ data }: any) => {
      const user = {
        id: `mock-user-${Date.now()}`,
        name: data.name || null,
        email: data.email,
        image: data.image || null,
        role: 'USER' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockUsers.push(user);
      return user;
    },
  },
  account: {
    findUnique: async ({ where }: any) => mockAccounts.find(account =>
      account.provider === where.provider_providerAccountId?.provider &&
      account.providerAccountId === where.provider_providerAccountId?.providerAccountId
    ) || null,
    findFirst: async ({ where }: any) => mockAccounts.find(account => account.userId === where.userId) || null,
    create: async ({ data }: any) => {
      const account = { ...data, id: `mock-account-${Date.now()}` } as Account;
      mockAccounts.push(account);
      return account;
    },
  },
  starMark: {
    upsert: async ({ where, update, create }: any) => {
      const key = where.userId_playgroundId;
      const existing = mockStarMarks.find(mark =>
        mark.userId === key.userId && mark.playgroundId === key.playgroundId
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const mark = { ...create, id: `mock-star-${Date.now()}`, createdAt: new Date() };
      mockStarMarks.push(mark);
      return mark;
    },
    deleteMany: async ({ where }: any) => {
      const before = mockStarMarks.length;
      for (let i = mockStarMarks.length - 1; i >= 0; i--) {
        if (mockStarMarks[i].userId === where.userId && mockStarMarks[i].playgroundId === where.playgroundId) {
          mockStarMarks.splice(i, 1);
        }
      }
      return { count: before - mockStarMarks.length };
    },
  },
  chatMessage: {
    create: async ({ data }: any) => {
      const message = { ...data, id: `mock-chat-${Date.now()}-${mockChatMessages.length}`, createdAt: new Date() };
      mockChatMessages.push(message);
      return message;
    },
    deleteMany: async ({ where }: any) => {
      const before = mockChatMessages.length;
      for (let i = mockChatMessages.length - 1; i >= 0; i--) {
        const message = mockChatMessages[i];
        if (message.userId === where.userId && message.playgroundId === where.playgroundId && where.id.in.includes(message.id)) mockChatMessages.splice(i, 1);
      }
      return { count: before - mockChatMessages.length };
    },
    findMany: async ({ where, take, skip = 0 }: any) => mockChatMessages
      .filter(message =>
        (!where?.userId || message.userId === where.userId) &&
        (!where?.playgroundId || message.playgroundId === where.playgroundId)
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(skip, take ? skip + take : undefined)
      .map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt })),
  },
  playgroundMember: {
    findUnique: async ({ where }: any) => mockPlaygroundMembers.find(member =>
      member.playgroundId === where.playgroundId_userId?.playgroundId &&
      member.userId === where.playgroundId_userId?.userId
    ) || null,
    findFirst: async ({ where }: any) => mockPlaygroundMembers.find(member =>
      (!where.id || member.id === where.id) && (!where.playgroundId || member.playgroundId === where.playgroundId)
    ) || null,
    findMany: async ({ where }: any) => mockPlaygroundMembers
      .filter(member => member.playgroundId === where.playgroundId)
      .map(member => ({ ...member, user: mockUsers.find(user => user.id === member.userId) })),
    upsert: async ({ where, update, create }: any) => {
      const key = where.playgroundId_userId;
      const existing = mockPlaygroundMembers.find(member => member.playgroundId === key.playgroundId && member.userId === key.userId);
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return { ...existing, user: mockUsers.find(user => user.id === existing.userId) };
      }
      const member: PlaygroundMember = { ...create, id: `mock-member-${Date.now()}`, createdAt: new Date(), updatedAt: new Date() };
      mockPlaygroundMembers.push(member);
      return { ...member, user: mockUsers.find(user => user.id === member.userId) };
    },
    update: async ({ where, data }: any) => {
      const member = mockPlaygroundMembers.find(item => item.id === where.id);
      if (!member) throw new Error('Collaborator not found');
      Object.assign(member, data, { updatedAt: new Date() });
      return member;
    },
    deleteMany: async ({ where }: any) => {
      const before = mockPlaygroundMembers.length;
      for (let index = mockPlaygroundMembers.length - 1; index >= 0; index--) {
        const member = mockPlaygroundMembers[index];
        if ((!where.id || member.id === where.id) && (!where.playgroundId || member.playgroundId === where.playgroundId)) mockPlaygroundMembers.splice(index, 1);
      }
      return { count: before - mockPlaygroundMembers.length };
    },
  },
  collaborationDocument: {
    findMany: async ({ where, take }: any) => mockCollaborationDocuments.filter(document => document.playgroundId === where.playgroundId).slice(0, take),
    findUnique: async ({ where }: any) => mockCollaborationDocuments.find(document => document.room === where.room) || null,
    upsert: async ({ where, update, create }: any) => {
      const existing = mockCollaborationDocuments.find(document => document.room === where.room);
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return existing;
      }
      const document = {
        ...create,
        id: `mock-collaboration-${Date.now()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockCollaborationDocuments.push(document);
      return document;
    },
    deleteMany: async ({ where }: any) => {
      const before = mockCollaborationDocuments.length;
      for (let index = mockCollaborationDocuments.length - 1; index >= 0; index--) {
        if (mockCollaborationDocuments[index].playgroundId === where.playgroundId &&
          (!where.filePath?.not || mockCollaborationDocuments[index].filePath !== where.filePath.not)) mockCollaborationDocuments.splice(index, 1);
      }
      return { count: before - mockCollaborationDocuments.length };
    },
  },
  playgroundSnapshot: {
    count: async ({ where }: any) => mockPlaygroundSnapshots.filter(snapshot => snapshot.playgroundId === where.playgroundId).length,
    findMany: async ({ where, take, select }: any) => mockPlaygroundSnapshots
      .filter(snapshot => snapshot.playgroundId === where.playgroundId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
      .slice(0, take).map(snapshot => copySelected(snapshot, select)),
    findFirst: async ({ where, select }: any) => copySelected(mockPlaygroundSnapshots.find(snapshot =>
      snapshot.id === where.id && snapshot.playgroundId === where.playgroundId
    ), select),
    create: async ({ data, select }: any) => {
      const snapshot = { ...structuredClone(data), id: crypto.randomUUID(), createdAt: new Date() };
      mockPlaygroundSnapshots.push(snapshot);
      return copySelected(snapshot, select);
    },
    deleteMany: async ({ where }: any) => {
      const before = mockPlaygroundSnapshots.length;
      for (let index = mockPlaygroundSnapshots.length - 1; index >= 0; index--) {
        const snapshot = mockPlaygroundSnapshots[index];
        if (snapshot.id === where.id && snapshot.playgroundId === where.playgroundId) mockPlaygroundSnapshots.splice(index, 1);
      }
      return { count: before - mockPlaygroundSnapshots.length };
    },
  },
  playgroundHistoryEvent: {
    findMany: async ({ where, take }: any) => mockPlaygroundHistoryEvents
      .filter(event => event.playgroundId === where.playgroundId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
      .slice(0, take).map(event => structuredClone(event)),
    create: async ({ data }: any) => {
      const event = { ...structuredClone(data), id: crypto.randomUUID(), createdAt: new Date() };
      mockPlaygroundHistoryEvents.push(event);
      return structuredClone(event);
    },
  },
});

// Next.js can bundle this module independently for routes and server actions.
// Share the delegate object (and its captured fixture arrays) within the server
// process so invitations, snapshots and revocations see the same mock records.
const developmentGlobal = globalThis as unknown as { liveideMockDbV26?: ReturnType<typeof createMockDb> };
export const mockDb = developmentGlobal.liveideMockDbV26 ??= createMockDb();
