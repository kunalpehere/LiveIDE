import AddNewButton from "@/features/dashboard/components/add-new-btn";
import AddRepo from "@/features/dashboard/components/add-repo";
import ProjectTable from "@/features/dashboard/components/project-table";
import {
  deleteProjectById,
  duplicateProjectById,
  editProjectById,
  getAllPlaygroundForUser,
} from "@/features/playground/actions";
import { FolderKanban } from "lucide-react";

const DashboardMainPage = async () => {
  const playgrounds = await getAllPlaygroundForUser();
  const projects = playgrounds || [];
  const starredCount = projects.filter((project) => project.Starmark[0]?.isMarked).length;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-10 lg:py-12">
        <header className="flex flex-col gap-6 border-b pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs font-medium uppercase tracking-[0.16em] text-primary">Workspace</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Projects</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Create, manage, and reopen browser-based development environments.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AddRepo />
            <AddNewButton />
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 py-6 sm:flex sm:gap-8">
          <div>
            <p className="text-2xl font-semibold tracking-tight">{projects.length}</p>
            <p className="text-xs text-muted-foreground">Total projects</p>
          </div>
          <div className="sm:border-l sm:pl-8">
            <p className="text-2xl font-semibold tracking-tight">{starredCount}</p>
            <p className="text-xs text-muted-foreground">Favorites</p>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="mt-4 flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed bg-card/40 px-6 text-center">
            <span className="mb-5 grid size-12 place-items-center rounded-lg border bg-background">
              <FolderKanban className="size-5 text-muted-foreground" />
            </span>
            <h2 className="font-semibold">Create your first project</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Choose a starter template to open a complete browser-based development workspace.
            </p>
            <div className="mt-6"><AddNewButton /></div>
          </div>
        ) : (
          <ProjectTable
            projects={projects}
            onDeleteProject={deleteProjectById}
            onUpdateProject={editProjectById}
            onDuplicateProject={duplicateProjectById}
          />
        )}
      </div>
    </div>
  );
};

export default DashboardMainPage;
