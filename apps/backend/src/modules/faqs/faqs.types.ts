export interface FaqListFilters {
  page: number;
  limit: number;
  search?: string;
  category?: string;
  isActive?: boolean;
  sortBy: 'sortOrder' | 'question' | 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
}
