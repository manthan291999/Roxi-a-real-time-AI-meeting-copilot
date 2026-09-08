import { invoke } from '@tauri-apps/api/core';
import { IProjectRepository } from '../shared/interfaces/IProjectRepository';
import { Project } from '../shared/types';

/**
 * Tauri adapter for IProjectRepository.
 * The ONLY file that knows the Rust command names for project operations.
 */
export class TauriProjectRepository implements IProjectRepository {
  async list(): Promise<Project[]> {
    try {
      return await invoke<Project[]>('list_projects');
    } catch {
      // Picker must not crash the intake modal if the DB is unavailable.
      return [];
    }
  }

  async create(name: string, description?: string): Promise<Project> {
    return invoke<Project>('create_project', { name, description });
  }
}
