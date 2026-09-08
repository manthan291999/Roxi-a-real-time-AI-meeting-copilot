import { Project } from '../types';

/**
 * Port: read and write project taxonomy.
 *
 * Implementors: TauriProjectRepository (production), FakeProjectRepository (tests/storybook).
 * Callers: useProjectPicker (Phase 3), nothing else today.
 */
export interface IProjectRepository {
  /**
   * Returns all non-archived projects, recent-first.
   * Never throws — returns [] on network/permission error so the picker degrades gracefully.
   */
  list(): Promise<Project[]>;

  /**
   * Create a project and return the full row (including server-assigned id and code).
   * Throws if name is empty or collides with an existing name.
   */
  create(name: string, description?: string): Promise<Project>;
}
