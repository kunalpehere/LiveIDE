import { TemplateFile, TemplateFolder } from "./path-to-json";

export function findFilePath(
  file: Pick<TemplateFile, "filename" | "fileExtension"> & { id?: string },
  folder: TemplateFolder,
  pathSoFar: string[] = []
): string | null {
  const walk = (current: TemplateFolder, parents: string[], matches: (item: TemplateFile, path: string) => boolean): string | null => {
    for (const item of current.items) {
      if ("folderName" in item) {
        const found = walk(item, [...parents, item.folderName], matches);
        if (found) return found;
      } else {
        const path = [...parents, item.filename + (item.fileExtension ? "." + item.fileExtension : "")].join("/");
        if (matches(item, path)) return path;
      }
    }
    return null;
  };
  // Tree selections retain object identity; open drafts retain their path ID.
  // Resolve either before the name fallback to distinguish duplicate basenames.
  return walk(folder, pathSoFar, item => item === file)
    || (file.id ? walk(folder, pathSoFar, (item, path) => path === file.id && item.filename === file.filename && item.fileExtension === file.fileExtension) : null)
    || walk(folder, pathSoFar, item => item.filename === file.filename && item.fileExtension === file.fileExtension);
}


export async function longPoll<T>(
  url: string,
  options: RequestInit,
  checkCondition: (response: T) => boolean,
  interval: number = 1000, // Poll every 1 second
  timeout: number = 10000 // Timeout after 10 seconds
): Promise<T> {
  const startTime = Date.now();

  while (true) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: T = await response.json();

      // Check if the condition is met
      if (checkCondition(data)) {
        return data;
      }

      // Check if the timeout has been reached
      if (Date.now() - startTime >= timeout) {
        throw new Error("Long polling timed out");
      }

      // Wait for the specified interval before the next poll
      await new Promise((resolve) => setTimeout(resolve, interval));
    } catch (error) {
      console.error("Error during long polling:", error);
      throw error;
    }
  }
}

  // Helper function to generate unique file ID
/**
 * Generates a unique file ID based on file location in folder structure
 * @param file The template file
 * @param rootFolder The root template folder containing all files
 * @returns A unique file identifier including full path
 */
export const generateFileId = (file: TemplateFile, rootFolder: TemplateFolder): string => {
  // Find the file's path in the folder structure
  const path = findFilePath(file, rootFolder)?.replace(/^\/+/, '') || '';
  
  // Handle empty/undefined file extension
  if (path) return path;
  const extension = file.fileExtension?.trim();
  return `${file.filename}${extension ? `.${extension}` : ""}`;
}
