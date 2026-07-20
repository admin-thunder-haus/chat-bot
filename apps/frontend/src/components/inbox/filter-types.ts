import type {
  ChannelType,
  ConversationPriority,
  ConversationStatus,
} from '@/lib/types';

export type AssignmentFilter = 'all' | 'mine' | 'unassigned';

export interface FilterState {
  search: string;
  status: ConversationStatus | '';
  priority: ConversationPriority | '';
  channelType: ChannelType | '';
  assignment: AssignmentFilter;
  tagId: string;
  unreadOnly: boolean;
  archived: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  search: '',
  status: '',
  priority: '',
  channelType: '',
  assignment: 'all',
  tagId: '',
  unreadOnly: false,
  archived: false,
};
