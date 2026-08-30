import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage {
  productoId: string = '';
  resultado: any = null;

  constructor(private http: HttpClient) {}

  analizarProducto() {
    this.http.get<any>('http://localhost:3000/api/food/test-alergia').subscribe({
      next: (respuesta) => {
        this.resultado = respuesta.resultado;
      },
      error: (err) => {
        console.error('Error al analizar el producto:', err);
      }
    });
  }
}
