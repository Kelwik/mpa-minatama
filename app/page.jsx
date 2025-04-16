import { AppSidebar } from '@/components/app-sidebar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Box, FolderInput, FolderOutput } from 'lucide-react';
import { ChartBulan } from '@/components/chart-jenis';

export default function Dashboard() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="grid auto-rows-min gap-4 md:grid-cols-3">
            {/* Card 1: Light Green Gradient */}
            <Card
              className="w-full rounded-xl shadow-lg relative overflow-hidden"
              style={{
                background: 'linear-gradient(145deg, #ffffff, #d4f4d4)',
                boxShadow:
                  '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                border: '1px solid rgba(220, 252, 231, 0.7)',
              }}
            >
              <CardHeader>
                <CardTitle>
                  <h1 className="dark:text-black">Total Stok Lobster</h1>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center gap-12">
                  <p className="text-7xl dark:text-black">129</p>
                  <Box size={66} className="dark:stroke-black" />
                </div>
              </CardContent>
              <CardFooter className="pb-2">
                <p className="dark:text-black text-4xl">Ekor</p>
              </CardFooter>
            </Card>
            {/* Card 2: Light Blue Gradient */}
            <Card
              className="w-full rounded-xl shadow-lg relative overflow-hidden"
              style={{
                background: 'linear-gradient(145deg, #ffffff, #d4e4f4)',
                boxShadow:
                  '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                border: '1px solid rgba(220, 231, 252, 0.7)',
              }}
            >
              <CardHeader>
                <CardTitle>
                  <h1 className="dark:text-black">
                    Jumlah Lobster Masuk Bulan ini
                  </h1>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center gap-12">
                  <p className="text-7xl dark:text-black">129</p>
                  <FolderInput size={66} className="dark:stroke-black" />
                </div>
              </CardContent>
              <CardFooter className="pb-2">
                <p className="dark:text-black text-4xl">Ekor</p>
              </CardFooter>
            </Card>
            {/* Card 3: Light Purple Gradient */}
            <Card
              className="w-full rounded-xl shadow-lg relative overflow-hidden"
              style={{
                background: 'linear-gradient(145deg, #ffffff, #e4d4f4)',
                boxShadow:
                  '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                border: '1px solid rgba(231, 220, 252, 0.7)',
              }}
            >
              <CardHeader>
                <CardTitle>
                  <h1 className="dark:text-black">
                    Jumlah Lobster Dikirim Bulan Ini
                  </h1>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-center gap-12">
                  <p className="text-7xl dark:text-black">129</p>
                  <FolderOutput size={66} className="dark:stroke-black" />
                </div>
              </CardContent>
              <CardFooter className="pb-2">
                <p className="dark:text-black text-4xl">Ekor</p>
              </CardFooter>
            </Card>
          </div>

          <ChartBulan />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
