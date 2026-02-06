export interface CellComment {
  id: string;
  clientName: string;
  apiName: string;
  text: string;
  author: string;
  createdAt: string; // ISO timestamp
}

export interface ClientComment {
  id: string;
  clientName: string;
  text: string;
  author: string;
  createdAt: string; // ISO timestamp
  category: 'note' | 'action' | 'risk' | 'opportunity';
}
