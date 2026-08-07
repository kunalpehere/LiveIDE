export interface TemplateFile {
  filename: string;
  fileExtension: string;
  content: string;
}
export interface PlaygroundData {
  id: string;
  name?: string;
  title?: string;
  description?: string | null;
  template?: string;
}

export interface TemplateFolder {
  folderName: string;
  items: (TemplateFile | TemplateFolder)[];
}

export interface OpenFile extends TemplateFile {
  id: string;
  hasUnsavedChanges: boolean;
  content: string;
  originalContent: string;
}
