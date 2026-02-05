declare module 'react-visual-feedback' {
  import { ReactNode, ComponentType } from 'react';

  export interface FeedbackData {
    id: string;
    feedback: string;
    type: 'bug' | 'feature' | 'improvement' | 'question' | 'other';
    userName: string;
    userEmail: string | null;
    status: string;
    timestamp: string;
    url: string;
    userAgent: string;
    viewport: {
      width: number;
      height: number;
    };
    screenshot?: string;
    video?: string;
    attachment?: File;
    eventLogs?: EventLog[];
    elementInfo?: ElementInfo;
  }

  export interface EventLog {
    timestamp: number;
    type: 'log' | 'warn' | 'error' | 'info' | 'network';
    message: string;
    data?: any;
  }

  export interface ElementInfo {
    tagName: string;
    id: string;
    className: string;
    selector: string;
    text: string;
    position: { x: number; y: number; width: number; height: number };
    styles: { backgroundColor: string; color: string; fontSize: string };
    sourceFile?: string;
    lineNumber?: number;
    columnNumber?: number;
    componentStack?: string[];
  }

  export interface StatusChangeData {
    id: string;
    status: string;
    comment?: string;
  }

  export interface FeedbackProviderProps {
    children: ReactNode;
    onSubmit: (data: FeedbackData) => Promise<void>;
    onStatusChange?: (data: StatusChangeData) => void;
    dashboard?: boolean;
    dashboardData?: FeedbackData[];
    isDeveloper?: boolean;
    isUser?: boolean;
    userName?: string;
    userEmail?: string | null;
    mode?: 'light' | 'dark';
    isActive?: boolean;
    onActiveChange?: (active: boolean) => void;
    defaultOpen?: boolean;
  }

  export interface FeedbackDashboardProps {
    isOpen: boolean;
    onClose: () => void;
    data?: FeedbackData[];
    isDeveloper?: boolean;
    isUser?: boolean;
    onStatusChange?: (data: StatusChangeData) => void;
    mode?: 'light' | 'dark';
    isLoading?: boolean;
    onRefresh?: () => void;
    title?: string;
    statuses?: Record<string, StatusConfig>;
    acceptableStatuses?: string[];
    showAllStatuses?: boolean;
    error?: string | null;
  }

  export interface StatusConfig {
    key: string;
    label: string;
    color: string;
    bgColor: string;
    textColor: string;
    icon: string;
  }

  export interface UseFeedbackReturn {
    isActive: boolean;
    setIsActive: (active: boolean) => void;
    setIsDashboardOpen: (open: boolean) => void;
    startRecording: () => void;
  }

  export interface UpdatesModalProps {
    isOpen: boolean;
    onClose: () => void;
    updates: Update[];
    title?: string;
    mode?: 'light' | 'dark';
  }

  export interface Update {
    id: string;
    type: 'solved' | 'new_feature';
    title: string;
    description?: string;
    date?: string;
    version?: string;
    category?: string;
  }

  export interface SessionReplayProps {
    videoSrc: string;
    eventLogs?: EventLog[];
    mode?: 'light' | 'dark';
    showLogsButton?: boolean;
    logsPanelWidth?: string;
    defaultLogsOpen?: boolean;
  }

  export const FeedbackProvider: ComponentType<FeedbackProviderProps>;
  export const FeedbackDashboard: ComponentType<FeedbackDashboardProps>;
  export const FeedbackModal: ComponentType<any>;
  export const FeedbackTrigger: ComponentType<any>;
  export const CanvasOverlay: ComponentType<any>;
  export const UpdatesModal: ComponentType<UpdatesModalProps>;
  export const SessionReplay: ComponentType<SessionReplayProps>;

  export const StatusBadge: ComponentType<any>;
  export const StatusDropdown: ComponentType<any>;

  export function useFeedback(): UseFeedbackReturn;

  export function getStatusData(status: string, statuses?: Record<string, StatusConfig>): StatusConfig;
  export function getIconComponent(iconName: string): ComponentType<any>;
  export function normalizeStatusKey(key: string, statuses?: Record<string, StatusConfig>): string;
  export function saveFeedbackToLocalStorage(data: FeedbackData): void;

  export function getTheme(mode: 'light' | 'dark'): any;
  export const lightTheme: any;
  export const darkTheme: any;

  export function getElementInfo(element: HTMLElement): ElementInfo;
  export function captureElementScreenshot(element: HTMLElement): Promise<string>;
  export function getReactComponentInfo(element: HTMLElement): any;
  export function formatPath(path: string): string;

  export const DEFAULT_STATUSES: Record<string, StatusConfig>;
}
