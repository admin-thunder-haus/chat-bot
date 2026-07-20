export interface KnowledgeListFilters {
  page: number;
  limit: number;
  search?: string;
  category?: string;
  tag?: string;
  isActive?: boolean;
  sortBy: 'sortOrder' | 'title' | 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
}
