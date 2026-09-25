export interface CompanyFile {
  id: string;
  organization_id: string;
  space: 'shared' | 'private' | 'ai_workspace';
  visibility: string;
  owner_user_id: string | null;
  uploaded_by_user_id: string | null;
  uploaded_by_ai_employee_id: string | null;
  folder_id: string | null;
  original_name: string;
  extension: string;
  mime_type: string;
  category: 'image' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'text' | 'archive';
  size: number;
  status: string;
  scan_status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  uploader_name?: string | null;
}

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  space: 'shared' | 'private';
  created_by_user_id: string | null;
  created_at: string;
}

export type FilesTab = 'shared' | 'private' | 'recent' | 'trash';
