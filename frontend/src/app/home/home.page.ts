import { Component, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AlertController, LoadingController } from '@ionic/angular/lazy';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage {
  private http = inject(HttpClient);
  private alertCtrl = inject(AlertController);
  private loadingCtrl = inject(LoadingController);

  productoNombre: string = '';
  ingredientesTexto: string = '';
  resultado: any = null;
  errorMsg: string = '';

  private apiUrl = environment.apiUrl;

  async analizarProducto() {
    const nombre = this.productoNombre.trim();
    const ingredientesRaw = this.ingredientesTexto.trim();

    if (!nombre || !ingredientesRaw) {
      const alert = await this.alertCtrl.create({
        header: 'Campos requeridos',
        message: 'Ingresá el nombre del producto y al menos un ingrediente.',
        buttons: ['OK'],
      });
      await alert.present();
      return;
    }

    // Parse comma-separated ingredients into an array
    const ingredientes = ingredientesRaw
      .split(',')
      .map((i) => i.trim())
      .filter((i) => i.length > 0);

    if (ingredientes.length === 0) {
      const alert = await this.alertCtrl.create({
        header: 'Ingredientes inválidos',
        message: 'Ingresá los ingredientes separados por coma.',
        buttons: ['OK'],
      });
      await alert.present();
      return;
    }

    this.resultado = null;
    this.errorMsg = '';

    const loading = await this.loadingCtrl.create({
      message: 'Analizando producto...',
    });
    await loading.present();

    this.http
      .post<any>(`${this.apiUrl}/api/food/analizar`, {
        nombre,
        ingredientes,
      })
      .subscribe({
        next: async (respuesta) => {
          await loading.dismiss();
          this.resultado = respuesta.resultado;
        },
        error: async (err) => {
          await loading.dismiss();
          console.error('Error al analizar el producto:', err);
          this.errorMsg =
            err.error?.message ||
            'Ocurrió un error al conectar con el servidor.';
        },
      });
  }
}
