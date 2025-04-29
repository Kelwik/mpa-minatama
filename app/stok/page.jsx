'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { AppSidebar } from '@/components/app-sidebar';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

// Form schema for transaction
const formSchema = z.object({
  lobsterType: z.string().min(1, 'Lobster type is required'),
  weightClass: z.string().min(1, 'Weight class is required'),
  quantity: z.number().min(1, 'Quantity must be at least 1').int(),
  transactionType: z.enum(['ADD', 'DISTRIBUTE']),
  note: z.string().optional(),
});

export default function Stock() {
  const [user, setUser] = useState(null);
  const [stockByType, setStockByType] = useState([]);
  const [weightClasses, setWeightClasses] = useState({});
  const [lobsterTypes, setLobsterTypes] = useState([]);
  const [allWeightClasses, setAllWeightClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form setup
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      lobsterType: '',
      weightClass: '',
      quantity: 1,
      transactionType: 'ADD',
      note: '',
    },
  });

  // Check authentication
  const fetchSession = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    setUser(session?.user || null);
    setLoading(false);
  };

  // Fetch stock by type
  const fetchStockByType = async () => {
    try {
      const { data, error } = await supabase.from('inventory').select(`
          type_id,
          quantity,
          lobster_types (name)
        `);
      if (error) throw error;

      const grouped = data.reduce((acc, row) => {
        const typeName = row.lobster_types?.name;
        if (typeName) {
          acc[typeName] = (acc[typeName] || 0) + (row.quantity || 0);
        }
        return acc;
      }, {});
      const stockByTypeArray = Object.entries(grouped).map(
        ([name, total_quantity]) => ({
          lobster_type: name,
          total_quantity,
        })
      );
      setStockByType(stockByTypeArray);
    } catch (error) {
      setError(error.message);
    }
  };

  // Fetch weight classes for a type (only non-zero quantities)
  const fetchWeightClasses = async (typeName) => {
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), 5000);
      });

      const result = await Promise.race([
        (async () => {
          const { data: typeData, error: typeError } = await supabase
            .from('lobster_types')
            .select('id')
            .eq('name', typeName)
            .single();
          if (typeError) throw typeError;
          if (!typeData) return [];

          const { data: inventoryData, error: inventoryError } = await supabase
            .from('inventory')
            .select(
              `
              weight_class_id,
              quantity,
              weight_classes (weight_range)
            `
            )
            .eq('type_id', typeData.id)
            .gt('quantity', 0); // Only fetch weight classes with stock
          if (inventoryError) throw inventoryError;

          return inventoryData.map((row) => ({
            weight_range: row.weight_classes?.weight_range || 'Unknown',
            quantity: row.quantity || 0,
          }));
        })(),
        timeoutPromise,
      ]);

      setWeightClasses((prev) => ({
        ...prev,
        [typeName]: result,
      }));
    } catch (error) {
      setWeightClasses((prev) => ({
        ...prev,
        [typeName]: [],
      }));
    }
  };

  // Fetch form options (lobster types and weight classes)
  const fetchFormOptions = async () => {
    try {
      const { data: typesData, error: typesError } = await supabase
        .from('lobster_types')
        .select('id, name');
      if (typesError) throw typesError;
      setLobsterTypes(typesData || []);

      const { data: weightClassesData, error: wcError } = await supabase
        .from('weight_classes')
        .select('id, weight_range');
      if (wcError) throw wcError;
      setAllWeightClasses(weightClassesData || []);
    } catch (error) {
      setError(error.message);
    }
  };

  // Submit transaction
  const submitTransaction = async (values) => {
    try {
      setFormError(null);
      setIsSubmitting(true);
      const { lobsterType, weightClass, quantity, transactionType, note } =
        values;

      const { data: typeData, error: typeError } = await supabase
        .from('lobster_types')
        .select('id')
        .eq('name', lobsterType)
        .single();
      if (typeError) throw typeError;

      const { data: weightClassData, error: wcError } = await supabase
        .from('weight_classes')
        .select('id')
        .eq('weight_range', weightClass)
        .single();
      if (wcError) throw wcError;

      const { error: manageError } = await supabase.rpc('manage_inventory', {
        p_type_id: typeData.id,
        p_weight_class_id: weightClassData.id,
        p_quantity: quantity,
        p_transaction_type: transactionType,
        p_notes: note || null,
      });
      if (manageError) {
        if (manageError.message.includes('function public.manage_inventory')) {
          throw new Error(
            'Database function manage_inventory not found. Please contact support.'
          );
        }
        if (
          manageError.message.includes(
            'violates check constraint "transactions_quantity_check"'
          )
        ) {
          throw new Error(
            'Database error: Quantity constraint violation. Please contact support.'
          );
        }
        throw manageError;
      }

      // Refresh stock data
      await fetchStockByType();
      for (const type of stockByType) {
        await fetchWeightClasses(type.lobster_type);
      }
      form.reset();
      setIsModalOpen(false); // Close modal on success
      toast.success('Transaction Successful', {
        description: `${quantity} ${lobsterType} (${weightClass}) ${
          transactionType === 'ADD' ? 'added' : 'distributed'
        }.`,
        action: {
          label: 'View Transactions',
          onClick: () => (window.location.href = '/transaksi'),
        },
      });
    } catch (error) {
      setFormError(error.message);
      toast.error('Transaction Failed', {
        description: error.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Initial fetch and real-time subscriptions
  useEffect(() => {
    if (user) {
      const initialize = async () => {
        await fetchStockByType();
        await fetchFormOptions();
        for (const type of stockByType) {
          await fetchWeightClasses(type.lobster_type);
        }
      };
      initialize();

      const inventorySubscription = supabase
        .channel('inventory')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'inventory' },
          () => {
            fetchStockByType();
            stockByType.forEach((type) =>
              fetchWeightClasses(type.lobster_type)
            );
          }
        )
        .subscribe();

      const transactionsSubscription = supabase
        .channel('transactions')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'transactions' },
          () => {
            fetchStockByType();
            stockByType.forEach((type) =>
              fetchWeightClasses(type.lobster_type)
            );
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(inventorySubscription);
        supabase.removeChannel(transactionsSubscription);
      };
    }
  }, [user, stockByType.length]);

  // Authentication effect
  useEffect(() => {
    fetchSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user || null);
        setLoading(false);
      }
    );

    return () => {
      authListener.subscription?.unsubscribe();
    };
  }, []);

  // Render loading or error states
  if (loading) {
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
            <p>Loading stock...</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  if (!user) {
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
            <p>Please log in to view stock.</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  if (error) {
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
            <p className="text-red-500">Error: {error}</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

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
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold">Stock Management</h2>
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
              <DialogTrigger asChild>
                <Button>Add Transaction</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Transaction</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(submitTransaction)}
                    className="space-y-4"
                  >
                    <FormField
                      control={form.control}
                      name="lobsterType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Lobster Type</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select lobster type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {lobsterTypes.map((type) => (
                                <SelectItem key={type.id} value={type.name}>
                                  {type.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="weightClass"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Weight Class</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select weight class" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {allWeightClasses.map((wc) => (
                                <SelectItem key={wc.id} value={wc.weight_range}>
                                  {wc.weight_range}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="quantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Quantity</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={(e) =>
                                field.onChange(parseInt(e.target.value))
                              }
                              min="1"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="transactionType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Transaction Type</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select transaction type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="ADD">Add</SelectItem>
                              <SelectItem value="DISTRIBUTE">
                                Distribute
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="note"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Note (Optional)</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {formError && <p className="text-red-500">{formError}</p>}
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsModalOpen(false)}
                        disabled={isSubmitting}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? 'Submitting...' : 'Submit Transaction'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Stock by Type */}
          <div className="mb-8">
            <h3 className="text-xl font-semibold mb-4">
              Stock by Lobster Type
            </h3>
            {stockByType.length === 0 ? (
              <p>
                No inventory data available. Add lobsters using the button
                above.
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {stockByType.map((type) => (
                  <Card key={type.lobster_type} className="p-4">
                    <CardHeader>
                      <CardTitle>{type.lobster_type}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p>Total: {type.total_quantity} Ekor</p>
                      {weightClasses[type.lobster_type]?.length > 0 ? (
                        <div className="mt-2">
                          {weightClasses[type.lobster_type].map((wc) => (
                            <p key={wc.weight_range}>
                              {wc.weight_range}: {wc.quantity} Ekor
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-gray-500">
                          No weight classes with stock
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
