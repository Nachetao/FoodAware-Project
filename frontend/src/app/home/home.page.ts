import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, LoadingController } from '@ionic/angular/lazy';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { AnalisisService, ResultadoAnalisis } from '../analisis/analisis.service';
import { separarIngredientes } from '../analisis/ingredientes';
import {
  guardarPreferencias,
  leerPreferencias,
} from '../busqueda/preferencias-busqueda';
import { AVISO_ORIENTATIVO } from '../compartido/aviso-orientativo';
import { ErrorApi } from '../products/models/error';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage {
  private analisis = inject(AnalisisService);
  private alertCtrl = inject(AlertController);
  private loadingCtrl = inject(LoadingController);
  private router = inject(Router);
  // El acceso "Personalizar según mi perfil" cambia según la sesión.
  readonly auth = inject(AuthService);

  readonly aviso = AVISO_ORIENTATIVO;

  textoBusqueda = '';

  productoNombre = '';
  ingredientesTexto = '';
  readonly resultado = signal<ResultadoAnalisis | null>(null);
  readonly error = signal('');

  /** Lleva a la búsqueda con lo escrito; la búsqueda lo lee de ?q=. */
  buscarProductos(): void {
    const q = this.textoBusqueda.trim();
    void this.router.navigate(['/busqueda'], q ? { queryParams: { q } } : {});
  }

  /** Activa la búsqueda personalizada (preferencia recordada) y va a buscar. */
  personalizarBusqueda(): void {
    guardarPreferencias({ ...leerPreferencias(), personalizar: true });
    void this.router.navigate(['/busqueda']);
  }

  async analizarProducto(): Promise<void> {
    const nombre = this.productoNombre.trim();

    if (!nombre || !this.ingredientesTexto.trim()) {
      await this.avisar(
        'Campos requeridos',
        'Ingresá el nombre del producto y al menos un ingrediente.',
      );
      return;
    }

    const ingredientes = separarIngredientes(this.ingredientesTexto);
    if (ingredientes.length === 0) {
      await this.avisar(
        'Ingredientes inválidos',
        'Ingresá los ingredientes separados por coma.',
      );
      return;
    }

    this.resultado.set(null);
    this.error.set('');

    const loading = await this.loadingCtrl.create({
      message: 'Analizando producto...',
    });
    await loading.present();

    try {
      const resultado = await firstValueFrom(
        this.analisis.analizar(nombre, ingredientes),
      );
      await loading.dismiss();
      this.resultado.set(resultado);
    } catch (error) {
      await loading.dismiss();
      this.error.set((error as ErrorApi).mensaje);
    }
  }

  private async avisar(header: string, message: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: ['OK'],
    });
    await alert.present();
  }
}
