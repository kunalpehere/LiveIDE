import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <div>
      <h1>Welcome to Angular Starter</h1>
      <p>Edit src/app/app.component.ts and save to reload.</p>
    </div>
  `,
  styles: [`
    div {
      text-align: center;
      padding: 20px;
    }
    h1 {
      color: #1976d2;
    }
  `]
})
export class AppComponent {
  title = 'angular-starter';
}
