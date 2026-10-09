"use client";

import React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { TemplateFileTree } from "@/features/playground/components/playground-explorer";
import type { TemplateFile } from "@/features/playground/libs/path-to-json";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  FileText,
  FolderOpen,
  AlertCircle,
  Save,
  X,
  Settings,
  PanelRight,
  Play,
  Github,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import WebContainerPreview from "@/features/webcontainers/components/webcontainer-preview";
import LoadingStep from "@/components/ui/loader";
const WorkspaceEditor = dynamic(() => import("@/features/playground/components/workspace-editor").then(module => module.WorkspaceEditor), { ssr: false });
const ProjectNotes = dynamic(() => import("@/features/playground/components/project-notes"), { ssr: false });
const SharedRuntimePanel = dynamic(() => import("@/features/webcontainers/components/shared-runtime-panel"), { ssr: false });
import { useSharedRuntime } from "@/features/webcontainers/hooks/useSharedRuntime";
import { useWorkspaceFiles } from "@/features/playground/hooks/useWorkspaceFiles";
import ToggleAI from "@/features/playground/components/toggle-ai";
import { useFileExplorer } from "@/features/playground/hooks/useFileExplorer";
import { usePlayground } from "@/features/playground/hooks/usePlayground";
import { useAISuggestions } from "@/features/playground/hooks/useAISuggestion";
import { useLivePreview } from "@/features/webcontainers/hooks/useLivePreview";
import { useWebContainer } from "@/features/webcontainers/hooks/useWebContainer";
import { TemplateFolder, TemplateFile as TreeTemplateFile } from "@/features/playground/types";
import { findFilePath } from "@/features/playground/libs";
import { ConfirmationDialog } from "@/features/playground/components/dialogs/confirmation-dialog";
import { SharePlaygroundDialog } from "@/features/playground/components/share-playground-dialog";
import { PlaygroundHistoryDialog } from "@/features/playground/components/playground-history-dialog";
import { StatusBar } from "@/features/playground/components/status-bar";
import { Badge } from "@/components/ui/badge";

const MainPlaygroundPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  // UI state
  const [confirmationDialog, setConfirmationDialog] = useState({
    isOpen: false,
    title: "",
    description: "",
    onConfirm: () => {},
    onCancel: () => {},
  });

  const [isPreviewVisible, setIsPreviewVisible] = useState(true);
  const [livePreview, setLivePreview] = useState(false);
  const [notesRequested, setNotesRequested] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [sharedRuntimeOpen, setSharedRuntimeOpen] = useState(false);

  // Custom hooks
  const { playgroundData, templateData, isLoading, error, saveTemplateData } =
    usePlayground(id);
  const aiSuggestions = useAISuggestions();
  const canEdit = playgroundData?.accessRole === "OWNER" || playgroundData?.accessRole === "EDITOR";
  const collaborationEnabled = Boolean(process.env.NEXT_PUBLIC_COLLABORATION_URL);
  const {
    activeFileId,
    closeAllFiles,
    openFile,
    closeFile,
    handleAddFile,
    handleAddFolder,
    handleDeleteFile,
    handleDeleteFolder,
    handleRenameFile,
    handleRenameFolder,
    setTemplateData,
    setActiveFileId,
    setPlaygroundId,
    setOpenFiles,
  } = useFileExplorer(useShallow(state => ({
    activeFileId: state.activeFileId,
    closeAllFiles: state.closeAllFiles,
    openFile: state.openFile,
    closeFile: state.closeFile,
    handleAddFile: state.handleAddFile,
    handleAddFolder: state.handleAddFolder,
    handleDeleteFile: state.handleDeleteFile,
    handleDeleteFolder: state.handleDeleteFolder,
    handleRenameFile: state.handleRenameFile,
    handleRenameFolder: state.handleRenameFolder,
    setTemplateData: state.setTemplateData,
    setActiveFileId: state.setActiveFileId,
    setPlaygroundId: state.setPlaygroundId,
    setOpenFiles: state.setOpenFiles,
  })));
  const openFiles = useWorkspaceFiles();

  const {
    serverUrl,
    error: containerError,
    instance,
    writeFileSync,
    phase: runtimePhase,
    startup: runtimeStartup,
    restart: restartRuntime,
    stop: stopRuntime,
    spawnProcess,
    subscribeOutput,
  } = useWebContainer({ projectId: id, canEdit, templateData: playgroundData?.id === id && !isLoading ? templateData : null });

  const live = useLivePreview({ projectId: id,
    template: playgroundData?.id === id && !isLoading ? templateData : null,
    phase: runtimePhase, enabled: livePreview, canEdit, writeFile: writeFileSync, restart: restartRuntime });
  const runProject = (forceRestart = false) => {
    if (!canEdit) return;
    setIsPreviewVisible(true);
    void live.run(forceRestart).catch(() => toast.error("Could not run project. Check the runtime output and retry."));
  };
  const sharing = useSharedRuntime({ playgroundId: id, enabled: collaborationEnabled && playgroundData?.id === id && !isLoading, canEdit,
    phase: runtimePhase, previewReady: Boolean(serverUrl), subscribeOutput,
    execute: async operation => {
      if (!canEdit) throw new Error("Runtime operations require editor access");
      if (operation === "stop") { stopRuntime(); return; }
      setIsPreviewVisible(true); await live.run(operation === "restart");
    },
  });

  // Set template data when playground loads
  React.useEffect(() => {
    setPlaygroundId(id);
  }, [id, setPlaygroundId]);

  // Initialize zustand templateData from usePlayground only on first load
  React.useEffect(() => {
    if (templateData && !openFiles.length) {

      
      setTemplateData(templateData);
    }
  }, [templateData, setTemplateData, openFiles.length]);

  // Create wrapper functions that pass saveTemplateData
  const wrappedHandleAddFile = useCallback(
    (newFile: TemplateFile, parentPath: string) => {
      return handleAddFile(
        newFile,
        parentPath,
        writeFileSync!,
        instance,
        saveTemplateData
      );
    },
    [handleAddFile, writeFileSync, instance, saveTemplateData]
  );

  const wrappedHandleAddFolder = useCallback(
    (newFolder: TemplateFolder, parentPath: string) => {
      return handleAddFolder(newFolder, parentPath, instance, saveTemplateData);
    },
    [handleAddFolder, instance, saveTemplateData]
  );

  const wrappedHandleDeleteFile = useCallback(
    (file: TemplateFile, parentPath: string) => {
      return handleDeleteFile(file, parentPath, saveTemplateData);
    },
    [handleDeleteFile, saveTemplateData]
  );

  const wrappedHandleDeleteFolder = useCallback(
    (folder: TemplateFolder, parentPath: string) => {
      return handleDeleteFolder(folder, parentPath, saveTemplateData);
    },
    [handleDeleteFolder, saveTemplateData]
  );

  const wrappedHandleRenameFile = useCallback(
    (
      file: TemplateFile,
      newFilename: string,
      newExtension: string,
      parentPath: string
    ) => {
      return handleRenameFile(
        file,
        newFilename,
        newExtension,
        parentPath,
        saveTemplateData
      );
    },
    [handleRenameFile, saveTemplateData]
  );

  const wrappedHandleRenameFolder = useCallback(
    (folder: TemplateFolder, newFolderName: string, parentPath: string) => {
      return handleRenameFolder(
        folder,
        newFolderName,
        parentPath,
        saveTemplateData
      );
    },
    [handleRenameFolder, saveTemplateData]
  );

  const activeFile = openFiles.find((file) => file.id === activeFileId);
  const activeFilePath = activeFile && templateData ? findFilePath(activeFile, templateData) || undefined : undefined;
  const hasUnsavedChanges = openFiles.some((file) => file.hasUnsavedChanges);

  const handleFileSelect = openFile;

  const handleSave = useCallback(
    async (fileId?: string) => {
      const state = useFileExplorer.getState();
      const targetFileId = fileId || state.activeFileId;
      if (!targetFileId) return;

      const fileToSave = state.openFiles.find((f) => f.id === targetFileId);
      if (!fileToSave) return;

      const latestTemplateData = useFileExplorer.getState().templateData;
      if (!latestTemplateData) return;

      try {
        const filePath = findFilePath(fileToSave, latestTemplateData);
        if (!filePath) {
          toast.error(
            `Could not find path for file: ${fileToSave.filename}.${fileToSave.fileExtension}`
          );
          return;
        }

        // Update file content in template data (clone for immutability)
        const updatedTemplateData = JSON.parse(
          JSON.stringify(latestTemplateData)
        );
        const updateFileContent = (
          items: (TreeTemplateFile | TemplateFolder)[]
        ): (TreeTemplateFile | TemplateFolder)[] =>
          items.map((item) => {
            if ("folderName" in item) {
              return { ...item, items: updateFileContent(item.items) };
            } else if (
              item.filename === fileToSave.filename &&
              item.fileExtension === fileToSave.fileExtension
            ) {
              return { ...item, content: fileToSave.content };
            }
            return item;
          });
        updatedTemplateData.items = updateFileContent(
          updatedTemplateData.items
        );

        // Sync with WebContainer
        if (writeFileSync) {
          await writeFileSync(filePath, fileToSave.content);
        }

        // Use saveTemplateData to persist changes
        await saveTemplateData(updatedTemplateData);
        setTemplateData(updatedTemplateData);

        // Update open files
        const currentOpenFiles = useFileExplorer.getState().openFiles;
        const updatedOpenFiles = currentOpenFiles.map((f) =>
          f.id === targetFileId
            ? {
                ...f,
                originalContent: fileToSave.content,
                hasUnsavedChanges: f.content !== fileToSave.content,
              }
            : f
        );
        setOpenFiles(updatedOpenFiles);

        toast.success(
          `Saved ${fileToSave.filename}.${fileToSave.fileExtension}`
        );
      } catch (error) {
        console.error("Error saving file:", error);
        toast.error(
          `Failed to save ${fileToSave.filename}.${fileToSave.fileExtension}`
        );
        throw error;
      }
    },
    [
      writeFileSync,
      saveTemplateData,
      setTemplateData,
      setOpenFiles,
    ]
  );

  const handleSaveAll = async () => {
    const unsavedFiles = useFileExplorer.getState().openFiles.filter((f) => f.hasUnsavedChanges);

    if (unsavedFiles.length === 0) {
      toast.info("No unsaved changes");
      return;
    }

    try {
      // Versioned persistence must be sequential so each save uses the version
      // returned by the previous write instead of creating false conflicts.
      for (const file of unsavedFiles) {
        await handleSave(file.id);
      }
      toast.success(`Saved ${unsavedFiles.length} file(s)`);
    } catch {
      toast.error("Failed to save some files");
    }
  };

  // Add event to save file by click ctrl + s
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] p-4">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-red-600 mb-2">
          Something went wrong
        </h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <Button onClick={() => window.location.reload()} variant="destructive">
          Try Again
        </Button>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] p-4">
        <div className="w-full max-w-md p-6 rounded-lg shadow-sm border">
          <h2 className="text-xl font-semibold mb-6 text-center">
            Loading project
          </h2>
          <div className="mb-8">
            <LoadingStep
              currentStep={1}
              step={1}
              label="Loading playground data"
            />
            <LoadingStep
              currentStep={2}
              step={2}
              label="Setting up environment"
            />
            <LoadingStep currentStep={3} step={3} label="Ready to code" />
          </div>
        </div>
      </div>
    );
  }

  // No template data
  if (!templateData) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)] p-4">
        <FolderOpen className="h-12 w-12 text-amber-500 mb-4" />
        <h2 className="text-xl font-semibold text-amber-600 mb-2">
          No template data available
        </h2>
        <Button onClick={() => window.location.reload()} variant="outline">
          Reload Template
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <>
        <TemplateFileTree
          data={templateData}
          onFileSelect={handleFileSelect}
          selectedFile={activeFile}
          title="Explorer"
          onAddFile={wrappedHandleAddFile}
          onAddFolder={wrappedHandleAddFolder}
          onDeleteFile={wrappedHandleDeleteFile}
          onDeleteFolder={wrappedHandleDeleteFolder}
          onRenameFile={wrappedHandleRenameFile}
          onRenameFolder={wrappedHandleRenameFolder}
        />

        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 h-4" />

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-medium">
                  {playgroundData?.title || "Untitled project"}
                </h1>
                <Badge variant="outline" className="hidden h-5 bg-muted/40 px-1.5 font-mono text-[9px] font-medium text-muted-foreground sm:inline-flex">
                  {playgroundData?.accessRole || "VIEWER"}
                </Badge>
                </div>
                <p className="truncate text-[11px] text-muted-foreground">
                  {openFiles.length} file(s) open
                  {hasUnsavedChanges && " • Unsaved changes"}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSave()}
                      disabled={!activeFile || !activeFile.hasUnsavedChanges || !canEdit}
                    >
                      <Save className="h-4 w-4" />
                      <span className="hidden md:inline">Save</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Save (Ctrl+S)</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSaveAll}
                      disabled={!hasUnsavedChanges || !canEdit}
                    >
                      <Save className="h-4 w-4" /> <span className="hidden lg:inline">Save all</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Save All (Ctrl+Shift+S)</TooltipContent>
                </Tooltip>
                {playgroundData?.githubImported && playgroundData.accessRole === "OWNER" && <Button asChild variant="outline" size="sm"><Link href={`/playground/${id}/github`} aria-label="GitHub changes" title="Review GitHub changes"><Github className="h-4 w-4" /><span className="hidden lg:inline">GitHub changes</span></Link></Button>}

                <ToggleAI
                  playgroundId={id}
                  isEnabled={aiSuggestions.isEnabled}
                  onToggle={aiSuggestions.toggleEnabled}
                  suggestionLoading={aiSuggestions.isLoading}
                  availability={aiSuggestions.availability}
                  error={aiSuggestions.error}
                  provider={aiSuggestions.provider}
                  model={aiSuggestions.model}
                />

                <SharePlaygroundDialog playgroundId={id} />
                <Button size="sm" variant={notesOpen ? "secondary" : "outline"} aria-pressed={notesOpen} onClick={() => { setSharedRuntimeOpen(false); setNotesRequested(true); setNotesOpen(value => !value); }}>Notes</Button>
                <Button size="sm" variant={sharedRuntimeOpen ? "secondary" : "outline"} aria-pressed={sharedRuntimeOpen} onClick={() => { setNotesOpen(false); setSharedRuntimeOpen(value => !value); }}>Shared runtime</Button>
                <PlaygroundHistoryDialog playgroundId={id} hasUnsavedChanges={hasUnsavedChanges} />

                <Button size="sm" variant="outline" onClick={() => runProject()}
                  disabled={!canEdit || !['ready', 'stopped', 'failed', 'idle'].includes(runtimePhase)}
                  title="Run current drafts without saving">
                  <Play className="h-4 w-4" /> Run
                </Button>
                <label className="flex items-center gap-1.5 text-xs" title="Update source drafts after a typing pause; Save still persists your work. Dependency edits need Save or Run.">
                  <input type="checkbox" checked={livePreview} disabled={!canEdit}
                    onChange={event => setLivePreview(event.target.checked)} /> Live preview
                </label>
                {livePreview && <span className="text-xs text-muted-foreground" role="status">
                  {live.status === "pending" ? "Updating preview…" : live.status === "synced" ? "Source preview updated" : live.status === "error" ? "Preview sync failed · try Run" : "Live preview paused"}
                </span>}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant={isPreviewVisible ? "secondary" : "outline"} onClick={() => setIsPreviewVisible(!isPreviewVisible)} aria-pressed={isPreviewVisible}>
                      <PanelRight className="h-4 w-4" />
                      <span className="hidden xl:inline">Preview</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isPreviewVisible ? "Hide preview" : "Show preview"}</TooltipContent>
                </Tooltip>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" aria-label="Workspace settings">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={closeAllFiles}>
                      Close all files
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
            {openFiles.length > 0 ? (
              <div className="min-h-0 flex-1 flex flex-col">
                {/* File Tabs */}
                <div className="border-b bg-muted/20">
                  <Tabs
                    value={activeFileId || ""}
                    onValueChange={setActiveFileId}
                  >
                    <div className="flex h-10 items-center justify-between px-2">
                      <TabsList className="h-10 justify-start gap-0 bg-transparent p-0">
                        {openFiles.map((file) => (
                          <TabsTrigger
                            key={file.id}
                            value={file.id}
                            className="group relative h-10 rounded-none border-x border-transparent px-3 text-xs data-[state=active]:border-border data-[state=active]:bg-background data-[state=active]:shadow-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-transparent data-[state=active]:after:bg-primary"
                          >
                            <div className="flex items-center gap-2">
                              <FileText className="h-3 w-3" />
                              <span>
                                {file.filename}.{file.fileExtension}
                              </span>
                              {file.hasUnsavedChanges && (
                                <span className="h-2 w-2 rounded-full bg-orange-500" />
                              )}
                              <span
                                className="ml-2 h-4 w-4 hover:bg-destructive hover:text-destructive-foreground rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  closeFile(file.id);
                                }}
                              >
                                <X className="h-3 w-3" />
                              </span>
                            </div>
                          </TabsTrigger>
                        ))}
                      </TabsList>

                      {openFiles.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={closeAllFiles}
                          className="h-6 px-2 text-xs"
                        >
                          Close all
                        </Button>
                      )}
                    </div>
                  </Tabs>
                </div>

                {/* Editor and Preview */}
                <div className="min-h-0 flex-1">
                  <ResizablePanelGroup
                    direction="horizontal"
                    className="h-full"
                  >
                    <ResizablePanel id="editor" order={1} defaultSize={50}>
                      <WorkspaceEditor
                        readOnly={!canEdit}
                        collaborationEnabled={collaborationEnabled}
                        playgroundId={id}
                        filePath={activeFilePath}
                        suggestion={aiSuggestions.suggestion}
                        suggestionLoading={aiSuggestions.isLoading}
                        suggestionPosition={aiSuggestions.position}
                        onAcceptSuggestion={aiSuggestions.acceptSuggestion}
                        onRejectSuggestion={aiSuggestions.rejectSuggestion}
                        onTriggerSuggestion={aiSuggestions.fetchSuggestion}
                      />
                    </ResizablePanel>

                    {isPreviewVisible && (
                      <>
                        <ResizableHandle />
                        <ResizablePanel id="preview" order={2} defaultSize={50}>
                          <WebContainerPreview
                            canEdit={canEdit}
                            projectId={id}
                            instance={instance}
                            phase={runtimePhase}
                            startup={runtimeStartup}
                            error={containerError}
                            serverUrl={serverUrl}
                            spawnProcess={spawnProcess}
                            subscribeOutput={subscribeOutput}
                            onRetry={() => runProject(true)}
                            onStop={stopRuntime}
                          />
                        </ResizablePanel>
                      </>
                    )}
                  </ResizablePanelGroup>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
                {runtimePhase === "unsupported" && (
                  <div role="alert" className="max-w-md rounded-lg border p-4">
                    <h2 className="text-sm font-semibold text-foreground">Browser runtime unavailable</h2>
                    <p className="mt-2 text-sm">{containerError}</p>
                  </div>
                )}
                <span className="grid size-12 place-items-center rounded-lg border bg-muted/30"><FileText className="h-5 w-5" /></span>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">No file selected</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Choose a file from Explorer to begin editing.
                  </p>
                </div>
              </div>
            )}
            <StatusBar
              isConnected={runtimePhase === "ready"}
              hasUnsavedChanges={hasUnsavedChanges}
              activeFile={activeFile ? `${activeFile.filename}.${activeFile.fileExtension}` : undefined}
              language={activeFile?.fileExtension || "plaintext"}
              accessRole={playgroundData?.accessRole}
              collaborationEnabled={collaborationEnabled}
              runtimePhase={runtimePhase}
            />
          </div>
        </SidebarInset>
        {notesRequested && <ProjectNotes key={id} playgroundId={id} enabled={collaborationEnabled} canEdit={canEdit} open={notesOpen} onClose={() => setNotesOpen(false)} />}
        {sharedRuntimeOpen && <SharedRuntimePanel sharing={sharing} canEdit={canEdit} onClose={() => setSharedRuntimeOpen(false)} />}

      <ConfirmationDialog
      isOpen={confirmationDialog.isOpen}
      title={confirmationDialog.title}
      description={confirmationDialog.description}
      onConfirm={confirmationDialog.onConfirm}
      onCancel={confirmationDialog.onCancel}
      setIsOpen={(open) => setConfirmationDialog((prev) => ({ ...prev, isOpen: open }))}
      />
      </>
    </TooltipProvider>
  );
};

export default MainPlaygroundPage;
