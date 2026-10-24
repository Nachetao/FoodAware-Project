import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';

import { HomePage } from './home.page';
import { AuthService } from '../auth/auth.service';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [HomePage],
      imports: [IonicModule.forRoot(), FormsModule],
      schemas: [CUSTOM_ELEMENTS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('botón "Analizar"', () => {
    // Simula lo que hace Ionic al escribir: actualiza value y emite ionInput.
    function escribir(selector: string, texto: string) {
      const el = fixture.nativeElement.querySelector(selector) as HTMLElement & { value: string };
      el.value = texto;
      el.dispatchEvent(new CustomEvent('ionInput', { detail: { value: texto } }));
    }

    function botonAnalizar(): HTMLElement & { disabled: boolean } {
      return fixture.nativeElement.querySelector('ion-button.ion-margin-top');
    }

    it('empieza deshabilitado', async () => {
      await fixture.whenStable();
      expect(botonAnalizar().disabled).toBe(true);
    });

    it('se habilita al escribir en ambos campos, sin detectChanges manual', async () => {
      escribir('ion-input', 'Barrita energética');
      await fixture.whenStable();
      expect(component.productoNombre).toBe('Barrita energética');
      expect(botonAnalizar().disabled).toBe(true);

      escribir('ion-textarea', 'avena, maní');
      await fixture.whenStable();

      expect(component.ingredientesTexto).toBe('avena, maní');
      expect(botonAnalizar().disabled).toBe(false);
    });

    it('vuelve a deshabilitarse si un campo queda solo con espacios', async () => {
      escribir('ion-input', 'Barrita');
      escribir('ion-textarea', 'avena');
      await fixture.whenStable();

      escribir('ion-textarea', '   ');
      await fixture.whenStable();

      expect(botonAnalizar().disabled).toBe(true);
    });
  });

  describe('toolbar según la sesión', () => {
    const toolbar = () => {
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };

    it('sin sesión muestra "Ingresar"', () => {
      expect(toolbar().querySelector('ion-button.ingresar')?.textContent?.trim()).toBe('Ingresar');
      expect(toolbar().querySelector('ion-button[aria-label="Mi perfil"]')).toBeNull();
    });

    it('con sesión muestra el ícono de perfil', () => {
      TestBed.inject(AuthService).token.set('jwt-1');

      expect(toolbar().querySelector('ion-button[aria-label="Mi perfil"]')).not.toBeNull();
      expect(toolbar().querySelector('ion-button.ingresar')).toBeNull();
    });
  });
});
