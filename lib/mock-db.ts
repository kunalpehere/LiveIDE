import type { Account, Playground, PlaygroundMember, TemplateFile, User } from '@prisma/client';

// Mock data for development
const mockPlaygrounds: Playground[] = [
  {
    id: 'mock-playground-1',
    title: 'React TypeScript Starter',
    description: 'A basic React TypeScript project',
    template: 'REACT',
    userId: 'mock-user-1',
    collaborationRevision: 1,
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
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const mockTemplateFiles: TemplateFile[] = [
  {
    id: 'mock-template-1',
    content: {
      folderName: 'Root',
      items: [
        {
          filename: 'package.json',
          fileExtension: 'json',
          content: JSON.stringify({
            name: 'react-ts-starter',
            version: '0.1.0',
            dependencies: {
              react: '^18.2.0',
              'react-dom': '^18.2.0',
              typescript: '^5.0.0'
            }
          }, null, 2)
        },
        {
          filename: 'src',
          fileExtension: '',
          content: 'folder'
        }
      ]
    },
    playgroundId: 'mock-playground-1',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
];

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
    email: 'collaborator@localhost',
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

export const mockDb = {
  playground: {
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
          templateFiles: mockTemplateFiles
            .filter(t => t.playgroundId === playground.id)
            .map(t => ({ content: t.content })),
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
        id: `mock-${Date.now()}`,
        collaborationRevision: playgroundData.collaborationRevision ?? 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
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
        mockPlaygrounds[index] = { ...mockPlaygrounds[index], ...data, collaborationRevision, updatedAt: new Date() };
        return mockPlaygrounds[index];
      }
      return null;
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
    findMany: async ({ where, take }: any) => mockChatMessages
      .filter(message =>
        (!where?.userId || message.userId === where.userId) &&
        (!where?.playgroundId || message.playgroundId === where.playgroundId)
      )
      .slice(-(take || mockChatMessages.length))
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
        if (mockCollaborationDocuments[index].playgroundId === where.playgroundId) mockCollaborationDocuments.splice(index, 1);
      }
      return { count: before - mockCollaborationDocuments.length };
    },
  },
  playgroundSnapshot: {
    findMany: async ({ where, take }: any) => mockPlaygroundSnapshots
      .filter(snapshot => snapshot.playgroundId === where.playgroundId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, take),
    findFirst: async ({ where }: any) => mockPlaygroundSnapshots.find(snapshot =>
      snapshot.id === where.id && snapshot.playgroundId === where.playgroundId
    ) || null,
    create: async ({ data }: any) => {
      const snapshot = { ...data, id: `mock-snapshot-${Date.now()}-${mockPlaygroundSnapshots.length}`, createdAt: new Date() };
      mockPlaygroundSnapshots.push(snapshot);
      return snapshot;
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
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, take),
    create: async ({ data }: any) => {
      const event = { ...data, id: `mock-history-${Date.now()}-${mockPlaygroundHistoryEvents.length}`, createdAt: new Date() };
      mockPlaygroundHistoryEvents.push(event);
      return event;
    },
  },
};
