import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Page, Stats, Transcription } from '../models';

export interface ListQuery {
  q?: string;
  language?: string;
  limit?: number;
  offset?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = '/api';

  list(query: ListQuery) {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
    }
    return this.http.get<Page<Transcription>>(`${this.base}/transcriptions`, { params });
  }

  get(id: number) {
    return this.http.get<Transcription>(`${this.base}/transcriptions/${id}`);
  }

  create(body: { title: string; text: string; language?: string | null }) {
    return this.http.post<Transcription>(`${this.base}/transcriptions`, body);
  }

  update(id: number, body: Partial<Pick<Transcription, 'title' | 'text' | 'language'>>) {
    return this.http.patch<Transcription>(`${this.base}/transcriptions/${id}`, body);
  }

  delete(id: number) {
    return this.http.delete<void>(`${this.base}/transcriptions/${id}`);
  }

  stats() {
    return this.http.get<Stats>(`${this.base}/stats`);
  }

  /** Server-side open-source TTS (Piper). Rejects if unavailable. */
  tts(text: string, language = 'auto'): Promise<Blob> {
    return firstValueFrom(this.http.post(`${this.base}/tts`, { text, language }, { responseType: 'blob' }));
  }
}
