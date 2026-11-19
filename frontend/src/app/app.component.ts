import { Component, inject } from '@angular/core';
import { InstalacionService } from './pwa/instalacion.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  constructor() {
    // Se crea al iniciar: beforeinstallprompt llega una sola vez, muy pronto.
    inject(InstalacionService);
  }
}
