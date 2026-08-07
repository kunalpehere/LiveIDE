import type { FileSystemTree } from "@webcontainer/api";
import type { TemplateFolder, TemplateItem } from "@/features/playground/libs/path-to-json";

function isFolder(item: TemplateItem): item is TemplateFolder {
  return "folderName" in item;
}

function itemName(item: TemplateItem) {
  if (isFolder(item)) return item.folderName;
  return item.fileExtension ? `${item.filename}.${item.fileExtension}` : item.filename;
}

function processItem(item: TemplateItem): FileSystemTree[string] {
  if (isFolder(item)) {
    return { directory: transformItems(item.items) };
  }
  return { file: { contents: item.content } };
}

function transformItems(items: TemplateItem[]): FileSystemTree {
  const result: FileSystemTree = {};
  for (const item of items) result[itemName(item)] = processItem(item);
  return result;
}

export function transformToWebContainerFormat(template: TemplateFolder): FileSystemTree {
  return transformItems(template.items);
}
