'use client';

import { TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';

const chartData = [
  { month: 'January', Masuk: 186, Keluar: 80 },
  { month: 'February', Masuk: 305, Keluar: 200 },
  { month: 'March', Masuk: 237, Keluar: 120 },
  { month: 'April', Masuk: 73, Keluar: 190 },
  { month: 'May', Masuk: 209, Keluar: 130 },
  { month: 'June', Masuk: 214, Keluar: 140 },
];

const chartConfig = {
  Masuk: {
    label: 'Masuk',
    color: 'hsl(var(--chart-1))',
  },
  Keluar: {
    label: 'Keluar',
    color: 'hsl(var(--chart-2))',
  },
};

export function ChartBulan() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bar Chart - Multiple</CardTitle>
        <CardDescription>January - June 2024</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          style={{ height: '300px', width: '100%' }}
        >
          <BarChart accessibilityLayer data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tickFormatter={(value) => value.slice(0, 3)}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent indicator="dashed" />}
            />
            <Bar dataKey="Masuk" fill="#8884d8" radius={4} />
            <Bar dataKey="Keluar" fill="#82ca9d" radius={4} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
